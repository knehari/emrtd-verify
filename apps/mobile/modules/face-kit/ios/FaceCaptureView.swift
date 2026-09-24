import AVFoundation
import CoreImage
import ExpoModulesCore
import UIKit
import Vision

/// Aperçu caméra frontale + détection de visage Apple Vision sur le flux, sans jamais enregistrer
/// de vidéo. Chaque image analysée remonte au JS le nombre de visages et, pour le principal, son
/// cadre, l'orientation de la tête et l'ouverture des yeux (src/faceMatch/selfieLiveness.ts en tire
/// les consignes et la vivacité). Sur demande (`captureRequest`), l'image courante est recadrée
/// autour du visage et renvoyée en RGB pour la comparaison avec la photo de la puce.
public final class FaceCaptureView: ExpoView, AVCaptureVideoDataOutputSampleBufferDelegate {
  let onFaceFrame = EventDispatcher()
  let onCaptured = EventDispatcher()

  private let session = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "authentik.facekit.session")
  private let videoQueue = DispatchQueue(label: "authentik.facekit.video")
  private let previewLayer = AVCaptureVideoPreviewLayer()
  private let ciContext = CIContext()

  // Accédés uniquement sur sessionQueue.
  private var isConfigured = false
  private var wantsActive = true
  private var isInWindow = false

  // Accédés uniquement sur videoQueue.
  private var lastAnalysis: CFAbsoluteTime = 0
  private var handledCapture = 0

  // Écrit sur le thread principal, lu sur videoQueue.
  private let stateLock = NSLock()
  private var pendingCapture = 0

  /// ~15 images/s : assez pour saisir un clignement (150 à 300 ms).
  private static let minimumAnalysisInterval: CFAbsoluteTime = 0.066

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black
    previewLayer.session = session
    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)
  }

  deinit {
    let session = self.session
    sessionQueue.async {
      if session.isRunning {
        session.stopRunning()
      }
    }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    previewLayer.frame = bounds
    CATransaction.commit()
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    let inWindow = window != nil
    sessionQueue.async {
      self.isInWindow = inWindow
      self.updateRunningState()
    }
  }

  func setActive(_ active: Bool) {
    sessionQueue.async {
      self.wantsActive = active
      self.updateRunningState()
    }
  }

  func requestCapture(_ request: Int) {
    stateLock.lock()
    pendingCapture = request
    stateLock.unlock()
  }

  // MARK: - Session (sessionQueue)

  private func updateRunningState() {
    if wantsActive && isInWindow {
      configureSessionIfNeeded()
      guard isConfigured, !session.isRunning else {
        return
      }
      session.startRunning()
    } else if session.isRunning {
      session.stopRunning()
    }
  }

  private func configureSessionIfNeeded() {
    // L'autorisation caméra est demandée côté JS (expo-camera) avant d'afficher cette vue.
    guard !isConfigured, AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
      return
    }
    guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front),
          let input = try? AVCaptureDeviceInput(device: camera) else {
      return
    }
    let output = AVCaptureVideoDataOutput()
    output.alwaysDiscardsLateVideoFrames = true
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    output.setSampleBufferDelegate(self, queue: videoQueue)

    session.beginConfiguration()
    if session.canSetSessionPreset(.hd1280x720) {
      session.sessionPreset = .hd1280x720
    }
    guard session.canAddInput(input), session.canAddOutput(output) else {
      session.commitConfiguration()
      return
    }
    session.addInput(input)
    session.addOutput(output)
    // Images livrées droites et NON miroir (l'aperçu, lui, reste en miroir comme tout selfie) :
    // la comparaison se fait sur le vrai visage, comme la photo du document.
    if let connection = output.connection(with: .video) {
      if connection.isVideoOrientationSupported {
        connection.videoOrientation = .portrait
      }
      if connection.isVideoMirroringSupported {
        connection.automaticallyAdjustsVideoMirroring = false
        connection.isVideoMirrored = false
      }
    }
    session.commitConfiguration()
    isConfigured = true
  }

  // MARK: - Analyse des images (videoQueue)

  public func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    let now = CFAbsoluteTimeGetCurrent()
    guard now - lastAnalysis >= Self.minimumAnalysisInterval,
          let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      return
    }
    lastAnalysis = now

    guard let faces = try? FaceGeometry.detectFaces(in: pixelBuffer) else {
      return
    }
    let width = CGFloat(CVPixelBufferGetWidth(pixelBuffer))
    let height = CGFloat(CVPixelBufferGetHeight(pixelBuffer))

    var frame: [String: Any] = ["faceCount": faces.count, "timestamp": now * 1000]
    if let main = faces.max(by: { $0.area < $1.area }) {
      frame["box"] = [
        "x": Double(main.box.minX / width),
        "y": Double(main.box.minY / height),
        "width": Double(main.box.width / width),
        "height": Double(main.box.height / height)
      ]
      frame["turn"] = main.turn
      frame["eyeOpenness"] = main.eyeOpenness
    }
    DispatchQueue.main.async { [weak self] in
      self?.onFaceFrame(frame)
    }

    stateLock.lock()
    let requested = pendingCapture
    stateLock.unlock()
    guard requested > 0, requested != handledCapture, faces.count == 1, let face = faces.first else {
      return
    }
    let image = CIImage(cvPixelBuffer: pixelBuffer)
    guard let cgImage = ciContext.createCGImage(image, from: image.extent),
          var capture = FaceGeometry.crop(cgImage, face: face) else {
      return
    }
    handledCapture = requested
    capture["faceCount"] = faces.count
    capture["request"] = requested
    DispatchQueue.main.async { [weak self] in
      self?.onCaptured(capture)
    }
  }
}
