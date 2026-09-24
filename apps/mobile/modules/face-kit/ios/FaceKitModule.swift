import ExpoModulesCore
import Foundation

final class UndecodableImageException: Exception {
  override var reason: String {
    "Image illisible (ni JPEG ni JPEG 2000 décodable)"
  }
}

final class NoFaceException: Exception {
  override var reason: String {
    "Aucun visage détecté dans l'image"
  }
}

final class CropFailedException: Exception {
  override var reason: String {
    "Recadrage du visage impossible"
  }
}

public final class FaceKitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FaceKit")

    /// Photo DG2 (JPEG ou JPEG 2000, base64) → recadrage RGB du plus grand visage + ses 5 repères.
    AsyncFunction("detectFaceInImage") { (base64: String) throws -> [String: Any] in
      guard let data = Data(base64Encoded: base64), let image = FaceGeometry.decodeImage(data) else {
        throw UndecodableImageException()
      }
      let faces = try FaceGeometry.detectFaces(in: image)
      guard let face = faces.max(by: { $0.area < $1.area }) else {
        throw NoFaceException()
      }
      guard var result = FaceGeometry.crop(image, face: face) else {
        throw CropFailedException()
      }
      result["faceCount"] = faces.count
      return result
    }

    View(FaceCaptureView.self) {
      Events("onFaceFrame", "onCaptured")

      Prop("active") { (view, active: Bool?) in
        view.setActive(active ?? true)
      }

      /// Chaque nouvelle valeur demande un recadrage de la prochaine image à visage unique.
      Prop("captureRequest") { (view, request: Int?) in
        view.requestCapture(request ?? 0)
      }
    }
  }
}
