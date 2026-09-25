import ARKit
import AVFoundation
import CoreImage
import ExpoModulesCore
import SceneKit
import UIKit

/// Vivacité ACTIVE par la caméra TrueDepth (ARKit, `ARFaceTrackingConfiguration`) — la source
/// prévue par le protocole de packages/emrtd-core/src/liveness (session.ts) : les coefficients
/// `ARFaceAnchor.blendShapes` et l'orientation de la tête viennent d'un vrai maillage 3D, qu'une
/// photo, une vidéo ou un écran rejoués devant la caméra ne produisent pas.
///
/// Chaque image suivie remonte au JS (`onLivenessFrame`, ~30/s) : clignements, ouverture de la
/// mâchoire, sourire, lacet de la tête en degrés (négatif = tourné vers la gauche du sujet), l'heure
/// de capture (epoch ms) et la couleur moyenne de la peau au centre du visage (canal lumineux du
/// défi). Sur demande (`captureRequest`), l'image courante est redressée, recadrée autour du visage
/// et renvoyée comme un selfie de FaceCaptureView (`onCaptured`), avec l'identifiant du visage
/// suivi : le JS vérifie que c'est le même visage, suivi sans interruption, qui a répondu au défi.
/// Aucune image n'est enregistrée.
public final class FaceLivenessModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FaceLiveness")

    /// Caméra TrueDepth présente (iPhone X et suivants, sauf SE).
    Function("isTrueDepthAvailable") { () -> Bool in
      ARFaceTrackingConfiguration.isSupported
    }

    View(FaceLivenessView.self) {
      Events("onLivenessFrame", "onCaptured", "onSessionError")

      Prop("active") { (view, active: Bool?) in
        view.setActive(active ?? true)
      }

      /// Chaque nouvelle valeur demande le selfie de la prochaine image où un visage est suivi.
      Prop("captureRequest") { (view, request: Int?) in
        view.requestCapture(request ?? 0)
      }

      /// Verrouille exposition et balance des blancs (iOS 16+) : pendant le défi lumineux, la
      /// caméra ne doit pas compenser les couleurs affichées par l'écran.
      Prop("lockCamera") { (view, lock: Bool?) in
        view.setCameraLocked(lock ?? false)
      }
    }
  }
}

public final class FaceLivenessView: ExpoView, ARSessionDelegate {
  let onLivenessFrame = EventDispatcher()
  let onCaptured = EventDispatcher()
  let onSessionError = EventDispatcher()

  private let sceneView = ARSCNView()
  private let processingQueue = DispatchQueue(label: "authentik.facekit.liveness")
  private let ciContext = CIContext()

  // Thread principal.
  private var wantsActive = true
  private var isRunning = false
  private var cameraLocked = false

  // processingQueue.
  private var lastEmitted: TimeInterval = 0
  private var handledCapture = 0

  // Écrit sur le thread principal, lu sur processingQueue.
  private let stateLock = NSLock()
  private var pendingCapture = 0

  /// ~30 images/s remontées au JS (ARKit suit le visage à 60 Hz).
  private static let minimumEmitInterval: TimeInterval = 0.030

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black
    sceneView.automaticallyUpdatesLighting = false
    sceneView.rendersCameraGrain = false
    sceneView.scene = SCNScene()
    sceneView.session.delegate = self
    sceneView.session.delegateQueue = processingQueue
    addSubview(sceneView)
  }

  deinit {
    sceneView.session.pause()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    sceneView.frame = bounds
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    updateRunningState()
  }

  func setActive(_ active: Bool) {
    wantsActive = active
    updateRunningState()
  }

  func requestCapture(_ request: Int) {
    stateLock.lock()
    pendingCapture = request
    stateLock.unlock()
  }

  func setCameraLocked(_ lock: Bool) {
    cameraLocked = lock
    applyCameraLock()
  }

  // MARK: - Session (thread principal)

  private func updateRunningState() {
    let shouldRun = wantsActive && window != nil
    if shouldRun && !isRunning {
      guard ARFaceTrackingConfiguration.isSupported else {
        onSessionError(["message": "Caméra TrueDepth absente sur cet appareil"])
        return
      }
      let configuration = ARFaceTrackingConfiguration()
      configuration.maximumNumberOfTrackedFaces = 1
      configuration.isLightEstimationEnabled = false
      sceneView.session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
      isRunning = true
      applyCameraLock()
    } else if !shouldRun && isRunning {
      sceneView.session.pause()
      isRunning = false
    }
  }

  private func applyCameraLock() {
    guard isRunning else {
      return
    }
    if #available(iOS 16.0, *) {
      guard let device = ARFaceTrackingConfiguration.configurableCaptureDeviceForPrimaryCamera,
            (try? device.lockForConfiguration()) != nil else {
        return
      }
      defer { device.unlockForConfiguration() }
      if cameraLocked {
        if device.isExposureModeSupported(.locked) {
          device.exposureMode = .locked
        }
        if device.isWhiteBalanceModeSupported(.locked) {
          device.whiteBalanceMode = .locked
        }
      } else {
        if device.isExposureModeSupported(.continuousAutoExposure) {
          device.exposureMode = .continuousAutoExposure
        }
        if device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) {
          device.whiteBalanceMode = .continuousAutoWhiteBalance
        }
      }
    }
  }

  // MARK: - ARSessionDelegate (processingQueue)

  public func session(_ session: ARSession, didUpdate frame: ARFrame) {
    // Horloge de capture (temps depuis le démarrage) → epoch ms, l'horloge du défi serveur.
    let epochMs = (Date().timeIntervalSince1970 - (ProcessInfo.processInfo.systemUptime - frame.timestamp)) * 1000
    let face = frame.anchors.compactMap { $0 as? ARFaceAnchor }.first(where: { $0.isTracked })

    if frame.timestamp - lastEmitted >= Self.minimumEmitInterval {
      lastEmitted = frame.timestamp
      var event: [String: Any] = ["timestamp": epochMs, "tracked": face != nil]
      if let face = face {
        let shapes = face.blendShapes
        func value(_ key: ARFaceAnchor.BlendShapeLocation) -> Double {
          Double(shapes[key]?.floatValue ?? 0)
        }
        event["anchorId"] = face.identifier.uuidString
        event["eyeBlinkLeft"] = value(.eyeBlinkLeft)
        event["eyeBlinkRight"] = value(.eyeBlinkRight)
        event["jawOpen"] = value(.jawOpen)
        event["mouthSmileLeft"] = value(.mouthSmileLeft)
        event["mouthSmileRight"] = value(.mouthSmileRight)
        event["headYawDegrees"] = Self.headYawDegrees(face: face, camera: frame.camera)
        if let color = Self.faceColor(frame: frame, face: face) {
          event["perceivedColor"] = ["r": color.r, "g": color.g, "b": color.b]
        }
      }
      DispatchQueue.main.async { [weak self] in
        self?.onLivenessFrame(event)
      }
    }

    stateLock.lock()
    let requested = pendingCapture
    stateLock.unlock()
    guard requested > 0, requested != handledCapture, let face = face else {
      return
    }
    // Image du capteur (paysage, non miroir) → portrait droit non miroir, comme la photo du document.
    let image = CIImage(cvPixelBuffer: frame.capturedImage).oriented(.right)
    guard let cgImage = ciContext.createCGImage(image, from: image.extent),
          let faces = try? FaceGeometry.detectFaces(in: cgImage),
          let main = faces.max(by: { $0.area < $1.area }),
          var capture = FaceGeometry.crop(cgImage, face: main) else {
      return
    }
    handledCapture = requested
    capture["faceCount"] = faces.count
    capture["request"] = requested
    capture["anchorId"] = face.identifier.uuidString
    capture["timestamp"] = epochMs
    if let jpeg = FaceGeometry.jpegBase64(cgImage) {
      capture["jpeg"] = jpeg
    }
    DispatchQueue.main.async { [weak self] in
      self?.onCaptured(capture)
    }
  }

  public func session(_ session: ARSession, didFailWithError error: Error) {
    let message = error.localizedDescription
    DispatchQueue.main.async { [weak self] in
      self?.isRunning = false
      self?.onSessionError(["message": message])
    }
  }

  public func sessionWasInterrupted(_ session: ARSession) {
    DispatchQueue.main.async { [weak self] in
      self?.onSessionError(["message": "Capture interrompue"])
    }
  }

  // MARK: - Mesures

  /// Lacet de la tête : direction de la caméra vue depuis le repère du visage. ARKit : +x du visage =
  /// sa propre gauche, +z vers l'observateur. Tête tournée vers la gauche du sujet → la caméra passe
  /// du côté droit du visage (x < 0) → angle négatif, la convention de `LivenessSignalFrame`.
  static func headYawDegrees(face: ARFaceAnchor, camera: ARCamera) -> Double {
    let cameraPosition = camera.transform.columns.3
    let inFace = simd_mul(simd_inverse(face.transform), cameraPosition)
    return Double(atan2(inFace.x, inFace.z)) * 180 / .pi
  }

  /// Couleur moyenne (RGB [0,1]) d'un carré de peau autour du centre du visage (nez, joues), lue
  /// dans l'image YCbCr du capteur — la lumière de l'écran réfléchie par le visage.
  static func faceColor(frame: ARFrame, face: ARFaceAnchor) -> (r: Double, g: Double, b: Double)? {
    let buffer = frame.capturedImage
    guard CVPixelBufferGetPlaneCount(buffer) >= 2 else {
      return nil
    }
    let resolution = frame.camera.imageResolution
    let origin = face.transform.columns.3
    let center = simd_float3(origin.x, origin.y, origin.z)
    let projected = frame.camera.projectPoint(center, orientation: .landscapeRight, viewportSize: resolution)
    guard projected.x.isFinite, projected.y.isFinite else {
      return nil
    }
    let half = Int(min(resolution.width, resolution.height) / 16)
    let width = CVPixelBufferGetWidthOfPlane(buffer, 0)
    let height = CVPixelBufferGetHeightOfPlane(buffer, 0)
    let cx = Int(projected.x)
    let cy = Int(projected.y)
    let x0 = max(0, cx - half)
    let x1 = min(width - 1, cx + half)
    let y0 = max(0, cy - half)
    let y1 = min(height - 1, cy + half)
    guard x1 > x0, y1 > y0 else {
      return nil
    }

    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    guard let lumaBase = CVPixelBufferGetBaseAddressOfPlane(buffer, 0),
          let chromaBase = CVPixelBufferGetBaseAddressOfPlane(buffer, 1) else {
      return nil
    }
    let luma = lumaBase.assumingMemoryBound(to: UInt8.self)
    let chroma = chromaBase.assumingMemoryBound(to: UInt8.self)
    let lumaStride = CVPixelBufferGetBytesPerRowOfPlane(buffer, 0)
    let chromaStride = CVPixelBufferGetBytesPerRowOfPlane(buffer, 1)

    var sumR = 0.0
    var sumG = 0.0
    var sumB = 0.0
    var count = 0.0
    // Un pixel sur deux : la chrominance est sous-échantillonnée 2×2 de toute façon.
    for y in stride(from: y0, through: y1, by: 2) {
      for x in stride(from: x0, through: x1, by: 2) {
        let yValue = Double(luma[y * lumaStride + x])
        let chromaIndex = (y / 2) * chromaStride + (x / 2) * 2
        let cb = Double(chroma[chromaIndex]) - 128
        let cr = Double(chroma[chromaIndex + 1]) - 128
        // BT.601 pleine échelle (format 420YpCbCr8BiPlanarFullRange d'ARKit).
        sumR += min(255, max(0, yValue + 1.402 * cr))
        sumG += min(255, max(0, yValue - 0.344136 * cb - 0.714136 * cr))
        sumB += min(255, max(0, yValue + 1.772 * cb))
        count += 1
      }
    }
    guard count > 0 else {
      return nil
    }
    return (sumR / count / 255, sumG / count / 255, sumB / count / 255)
  }
}
