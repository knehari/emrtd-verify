import AVFoundation
import ExpoModulesCore
import UIKit
import Vision

/// Aperçu caméra + reconnaissance de texte Apple Vision sur le flux vidéo, sans jamais prendre de
/// photo. Les lignes reconnues dans la région d'intérêt sont renvoyées au JS (texte + cadre normalisé
/// dans la vue) ; la validation MRZ (chiffres de contrôle, vote sur plusieurs images) se fait côté JS
/// dans src/mrz/mrzFromLines.ts, où elle est testée.
public final class MrzScannerView: ExpoView, AVCaptureVideoDataOutputSampleBufferDelegate {
  let onTextDetected = EventDispatcher()

  private let session = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "authentik.mrzscanner.session")
  private let videoQueue = DispatchQueue(label: "authentik.mrzscanner.video")
  private let previewLayer = AVCaptureVideoPreviewLayer()

  // Accédés uniquement sur sessionQueue.
  private var device: AVCaptureDevice?
  private var isConfigured = false
  private var wantsActive = true
  private var isInWindow = false
  private var torchOn = false
  private var format: DocumentFormat = .td1

  // Accédés uniquement sur videoQueue.
  private var lastAnalysis: CFAbsoluteTime = 0
  private var lastEmissionWasEmpty = true

  // Écrits sur le thread principal, lus sur videoQueue.
  private let stateLock = NSLock()
  private var viewSize: CGSize = .zero
  private var regionOfInterest = CGRect(x: 0, y: 0, width: 1, height: 1)
  private var minimumTextHeight: Float = DocumentFormat.td1.minimumTextHeight

  private static let minimumAnalysisInterval: CFAbsoluteTime = 0.1

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
    stateLock.lock()
    viewSize = bounds.size
    stateLock.unlock()
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

  func setTorch(_ on: Bool) {
    sessionQueue.async {
      self.torchOn = on
      self.applyTorch()
    }
  }

  func setDocumentFormat(_ newFormat: DocumentFormat) {
    stateLock.lock()
    minimumTextHeight = newFormat.minimumTextHeight
    stateLock.unlock()
    sessionQueue.async {
      guard newFormat != self.format else {
        return
      }
      self.format = newFormat
      guard self.isConfigured, let camera = self.device else {
        return
      }
      self.session.beginConfiguration()
      self.applyPreset()
      self.session.commitConfiguration()
      self.configureFocus(camera)
      self.applyTorch()
    }
  }

  func setRegionOfInterest(_ rect: CGRect) {
    stateLock.lock()
    regionOfInterest = rect
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
      applyTorch()
    } else if session.isRunning {
      session.stopRunning()
    }
  }

  private func configureSessionIfNeeded() {
    // L'autorisation caméra est demandée côté JS (expo-camera) avant d'afficher cette vue.
    guard !isConfigured, AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
      return
    }
    guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
          let input = try? AVCaptureDeviceInput(device: camera) else {
      return
    }
    let output = AVCaptureVideoDataOutput()
    output.alwaysDiscardsLateVideoFrames = true
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
    output.setSampleBufferDelegate(self, queue: videoQueue)

    session.beginConfiguration()
    guard session.canAddInput(input), session.canAddOutput(output) else {
      session.commitConfiguration()
      return
    }
    session.addInput(input)
    session.addOutput(output)
    applyPreset()
    session.commitConfiguration()

    configureFocus(camera)
    device = camera
    isConfigured = true
  }

  /// Passeport : la MRZ (44 caractères) est 1,5 fois plus large que celle d'une carte (30) et se lit
  /// donc de plus loin, en caractères plus petits — la 4K double la définition de chaque caractère.
  /// Vision n'analyse que la région d'intérêt, le surcoût reste limité.
  private func applyPreset() {
    let preferred: AVCaptureSession.Preset = format == .td3 ? .hd4K3840x2160 : .hd1920x1080
    if session.canSetSessionPreset(preferred) {
      session.sessionPreset = preferred
    } else if session.canSetSessionPreset(.hd1920x1080) {
      session.sessionPreset = .hd1920x1080
    }
  }

  private func configureFocus(_ camera: AVCaptureDevice) {
    guard (try? camera.lockForConfiguration()) != nil else {
      return
    }
    defer { camera.unlockForConfiguration() }
    if camera.isFocusModeSupported(.continuousAutoFocus) {
      camera.focusMode = .continuousAutoFocus
    }
    if camera.isAutoFocusRangeRestrictionSupported {
      camera.autoFocusRangeRestriction = .near
    }
    if camera.isExposureModeSupported(.continuousAutoExposure) {
      camera.exposureMode = .continuousAutoExposure
    }
    // Les iPhone récents (Pro) ne font pas la mise au point à moins de ~15-20 cm : on zoome pour que
    // la carte remplisse le cadre depuis cette distance plutôt que de laisser l'utilisateur la
    // rapprocher jusqu'au flou (même calcul que l'exemple AVCamBarcode d'Apple).
    let minimumFocusDistance = Float(camera.minimumFocusDistance)
    guard minimumFocusDistance > 0 else {
      return
    }
    let halfFieldOfView = camera.activeFormat.videoFieldOfView / 2 * .pi / 180
    // Largeur du document à faire tenir dans le cadre : un zoom calculé pour la carte obligerait à
    // tenir un passeport 1,5 fois plus loin que sa distance minimale de mise au point.
    let previewFill: Float = 0.88
    let subjectDistance = (format.documentWidthMillimeters / previewFill) / tan(halfFieldOfView)
    let zoom = subjectDistance < minimumFocusDistance ? CGFloat(minimumFocusDistance / subjectDistance) : 1
    camera.videoZoomFactor = max(camera.minAvailableVideoZoomFactor, min(zoom, camera.activeFormat.videoMaxZoomFactor))
  }

  private func applyTorch() {
    guard let device, device.hasTorch, device.isTorchAvailable else {
      return
    }
    guard (try? device.lockForConfiguration()) != nil else {
      return
    }
    device.torchMode = torchOn && session.isRunning ? .on : .off
    device.unlockForConfiguration()
  }

  // MARK: - Analyse des images (videoQueue)

  public func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    let now = CFAbsoluteTimeGetCurrent()
    guard now - lastAnalysis >= Self.minimumAnalysisInterval,
          let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      return
    }
    lastAnalysis = now

    stateLock.lock()
    let size = viewSize
    let roi = regionOfInterest
    let minTextHeight = minimumTextHeight
    stateLock.unlock()
    guard size.width > 0, size.height > 0 else {
      return
    }

    // Le capteur livre des images paysage ; `.right` les présente à Vision dans l'orientation
    // portrait affichée par l'aperçu.
    let imageSize = CGSize(width: CVPixelBufferGetHeight(pixelBuffer), height: CVPixelBufferGetWidth(pixelBuffer))
    let mapping = AspectFillMapping(imageSize: imageSize, viewSize: size)
    let visionRegion = mapping.visionRect(fromViewRect: roi)

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    // La MRZ n'est pas du langage naturel : la correction linguistique transformerait les suites de
    // '<' et les chiffres en mots.
    request.usesLanguageCorrection = false
    request.regionOfInterest = visionRegion
    request.minimumTextHeight = minTextHeight

    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .right, options: [:])
    guard (try? handler.perform([request])) != nil else {
      return
    }

    var lines: [[String: Any]] = []
    for observation in request.results ?? [] {
      guard let candidate = observation.topCandidates(1).first else {
        continue
      }
      // Les cadres renvoyés par Vision sont relatifs à la région d'intérêt.
      let box = observation.boundingBox
      let imageBox = CGRect(
        x: visionRegion.minX + box.minX * visionRegion.width,
        y: visionRegion.minY + box.minY * visionRegion.height,
        width: box.width * visionRegion.width,
        height: box.height * visionRegion.height
      )
      let viewBox = mapping.viewRect(fromVisionRect: imageBox)
      lines.append([
        "text": candidate.string,
        "x": Double(viewBox.minX),
        "y": Double(viewBox.minY),
        "width": Double(viewBox.width),
        "height": Double(viewBox.height)
      ])
    }

    if lines.isEmpty && lastEmissionWasEmpty {
      return
    }
    lastEmissionWasEmpty = lines.isEmpty
    DispatchQueue.main.async { [weak self] in
      self?.onTextDetected(["lines": lines])
    }
  }
}

/// Correspondance entre l'image redressée (portrait) et la vue qui l'affiche en `.resizeAspectFill`.
private struct AspectFillMapping {
  let viewSize: CGSize
  let displayedSize: CGSize
  let offset: CGPoint

  init(imageSize: CGSize, viewSize: CGSize) {
    self.viewSize = viewSize
    let scale = max(viewSize.width / imageSize.width, viewSize.height / imageSize.height)
    displayedSize = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
    offset = CGPoint(x: (viewSize.width - displayedSize.width) / 2, y: (viewSize.height - displayedSize.height) / 2)
  }

  /// Rectangle normalisé de la vue (origine en haut à gauche) → région Vision (normalisée à l'image,
  /// origine en bas à gauche).
  func visionRect(fromViewRect rect: CGRect) -> CGRect {
    let x = (rect.minX * viewSize.width - offset.x) / displayedSize.width
    let top = (rect.minY * viewSize.height - offset.y) / displayedSize.height
    let width = rect.width * viewSize.width / displayedSize.width
    let height = rect.height * viewSize.height / displayedSize.height
    let region = CGRect(x: x, y: 1 - top - height, width: width, height: height)
      .intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
    return region.isNull || region.isEmpty ? CGRect(x: 0, y: 0, width: 1, height: 1) : region
  }

  /// Rectangle Vision (normalisé à l'image, origine en bas à gauche) → rectangle normalisé de la vue.
  func viewRect(fromVisionRect rect: CGRect) -> CGRect {
    let top = 1 - rect.maxY
    return CGRect(
      x: (offset.x + rect.minX * displayedSize.width) / viewSize.width,
      y: (offset.y + top * displayedSize.height) / viewSize.height,
      width: rect.width * displayedSize.width / viewSize.width,
      height: rect.height * displayedSize.height / viewSize.height
    )
  }
}

/// Format ICAO de la MRZ attendue : règle le zoom, la définition et la taille minimale du texte.
enum DocumentFormat: String, Enumerable {
  case td1 = "TD1"
  case td3 = "TD3"

  /// Largeur du document (Doc 9303 Part 4 et 5) : ID-1 pour les cartes, ID-3 pour la page passeport.
  var documentWidthMillimeters: Float {
    self == .td3 ? 125 : 85.6
  }

  /// Relative à la région d'intérêt. Défaut Vision : 1/32 ; un passeport tenu plus loin a des
  /// caractères plus petits, qui seraient ignorés.
  var minimumTextHeight: Float {
    self == .td3 ? 1 / 64 : 1 / 32
  }
}
