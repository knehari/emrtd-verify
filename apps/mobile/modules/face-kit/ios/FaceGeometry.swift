import CoreGraphics
import Foundation
import ImageIO
import Vision

/// Visage détecté dans une image redressée et non miroir (pixels, origine en haut à gauche).
struct DetectedFace {
  let box: CGRect
  /// Ordre de `cv2.FaceDetectorYN` (attendu par src/faceMatch/align.ts) : œil côté gauche de l'image
  /// (œil droit du sujet), œil côté droit, pointe du nez, coin de bouche côté gauche, côté droit.
  let landmarks: [CGPoint]
  /// Ouverture moyenne des yeux (hauteur / largeur du contour) — chute nette pendant un clignement.
  let eyeOpenness: Double
  /// Décalage horizontal du nez par rapport au milieu des yeux, en distances inter-oculaires :
  /// ~0 de face, s'écarte de 0 quand la tête tourne.
  let turn: Double

  var area: CGFloat { box.width * box.height }
}

enum FaceGeometry {
  /// Côté maximal du recadrage renvoyé au JS : le visage y fait ~160 px, largement plus que les
  /// 112 px de l'entrée SFace, pour un transfert limité (~370 Ko RGB).
  static let maxCropSide: CGFloat = 352
  /// Le recadrage carré couvre 2,2 fois la largeur du visage : front, menton et oreilles compris.
  static let cropFactor: CGFloat = 2.2

  static func decodeImage(_ data: Data) -> CGImage? {
    // ImageIO lit le JPEG et le JPEG 2000 (les deux formats de DG2, Doc 9303 Part 10 §4.7.2.4).
    guard let source = CGImageSourceCreateWithData(data as CFData, nil) else {
      return nil
    }
    return CGImageSourceCreateImageAtIndex(source, 0, nil)
  }

  static func detectFaces(in image: CGImage) throws -> [DetectedFace] {
    let request = VNDetectFaceLandmarksRequest()
    try VNImageRequestHandler(cgImage: image, orientation: .up, options: [:]).perform([request])
    let size = CGSize(width: image.width, height: image.height)
    return (request.results ?? []).compactMap { face(from: $0, imageSize: size) }
  }

  static func detectFaces(in pixelBuffer: CVPixelBuffer) throws -> [DetectedFace] {
    let request = VNDetectFaceLandmarksRequest()
    try VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:]).perform([request])
    let size = CGSize(width: CVPixelBufferGetWidth(pixelBuffer), height: CVPixelBufferGetHeight(pixelBuffer))
    return (request.results ?? []).compactMap { face(from: $0, imageSize: size) }
  }

  static func face(from observation: VNFaceObservation, imageSize: CGSize) -> DetectedFace? {
    guard let marks = observation.landmarks,
          let leftEyeRegion = marks.leftEye,
          let rightEyeRegion = marks.rightEye,
          let lipsRegion = marks.outerLips else {
      return nil
    }
    // Vision : coordonnées image, origine en bas à gauche → origine en haut à gauche.
    func points(_ region: VNFaceLandmarkRegion2D) -> [CGPoint] {
      region.pointsInImage(imageSize: imageSize).map { CGPoint(x: $0.x, y: imageSize.height - $0.y) }
    }
    func centroid(_ pts: [CGPoint]) -> CGPoint? {
      guard !pts.isEmpty else {
        return nil
      }
      let sum = pts.reduce(CGPoint.zero) { CGPoint(x: $0.x + $1.x, y: $0.y + $1.y) }
      return CGPoint(x: sum.x / CGFloat(pts.count), y: sum.y / CGFloat(pts.count))
    }
    func openness(_ pts: [CGPoint]) -> Double {
      guard let minX = pts.map(\.x).min(), let maxX = pts.map(\.x).max(),
            let minY = pts.map(\.y).min(), let maxY = pts.map(\.y).max(), maxX > minX else {
        return 0
      }
      return Double((maxY - minY) / (maxX - minX))
    }

    let leftEyePoints = points(leftEyeRegion)
    let rightEyePoints = points(rightEyeRegion)
    guard let eyeA = marks.leftPupil.flatMap({ points($0).first }) ?? centroid(leftEyePoints),
          let eyeB = marks.rightPupil.flatMap({ points($0).first }) ?? centroid(rightEyePoints) else {
      return nil
    }
    let eyes = [eyeA, eyeB].sorted { $0.x < $1.x }

    let lips = points(lipsRegion)
    guard let mouthImageLeft = lips.min(by: { $0.x < $1.x }),
          let mouthImageRight = lips.max(by: { $0.x < $1.x }) else {
      return nil
    }

    // Pointe du nez : bas de l'arête du nez, à défaut le centre du contour du nez.
    let crest = marks.noseCrest.map(points) ?? []
    guard let noseTip = crest.max(by: { $0.y < $1.y }) ?? marks.nose.flatMap({ centroid(points($0)) }) else {
      return nil
    }

    let middle = CGPoint(x: (eyes[0].x + eyes[1].x) / 2, y: (eyes[0].y + eyes[1].y) / 2)
    let interocular = hypot(eyes[1].x - eyes[0].x, eyes[1].y - eyes[0].y)
    let turn = interocular > 0 ? Double((noseTip.x - middle.x) / interocular) : 0

    let bb = observation.boundingBox
    let box = CGRect(
      x: bb.minX * imageSize.width,
      y: (1 - bb.maxY) * imageSize.height,
      width: bb.width * imageSize.width,
      height: bb.height * imageSize.height
    )
    return DetectedFace(
      box: box,
      landmarks: [eyes[0], eyes[1], noseTip, mouthImageLeft, mouthImageRight],
      eyeOpenness: (openness(leftEyePoints) + openness(rightEyePoints)) / 2,
      turn: turn
    )
  }

  /// Recadrage carré centré sur le visage, réduit à `maxCropSide`, en RGB entrelacé (base64) avec
  /// le cadre et les 5 repères exprimés dans ce recadrage — format consommé par
  /// src/faceMatch/faceCrop.ts. Les zones hors de l'image restent noires.
  static func crop(_ image: CGImage, face: DetectedFace) -> [String: Any]? {
    let side = max(face.box.width, face.box.height) * cropFactor
    guard side > 0 else {
      return nil
    }
    let origin = CGPoint(x: face.box.midX - side / 2, y: face.box.midY - side / 2)
    let scale = min(1, maxCropSide / side)
    let outSide = Int((side * scale).rounded())
    guard outSide > 0 else {
      return nil
    }

    let bytesPerRow = outSide * 4
    var rgba = [UInt8](repeating: 0, count: outSide * bytesPerRow)
    let drawn: Bool = rgba.withUnsafeMutableBytes { buffer in
      guard let context = CGContext(
        data: buffer.baseAddress,
        width: outSide,
        height: outSide,
        bitsPerComponent: 8,
        bytesPerRow: bytesPerRow,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
      ) else {
        return false
      }
      context.interpolationQuality = .high
      // Repère Core Graphics (origine en bas à gauche) : le bas du recadrage doit tomber en y = 0.
      let imageHeight = CGFloat(image.height)
      let rect = CGRect(
        x: -origin.x * scale,
        y: -(imageHeight - origin.y - side) * scale,
        width: CGFloat(image.width) * scale,
        height: imageHeight * scale
      )
      context.draw(image, in: rect)
      return true
    }
    guard drawn else {
      return nil
    }

    var rgb = [UInt8](repeating: 0, count: outSide * outSide * 3)
    for pixel in 0..<(outSide * outSide) {
      rgb[pixel * 3] = rgba[pixel * 4]
      rgb[pixel * 3 + 1] = rgba[pixel * 4 + 1]
      rgb[pixel * 3 + 2] = rgba[pixel * 4 + 2]
    }

    let landmarks = face.landmarks.flatMap { point -> [Double] in
      [Double((point.x - origin.x) * scale), Double((point.y - origin.y) * scale)]
    }
    let box = [
      Double((face.box.minX - origin.x) * scale),
      Double((face.box.minY - origin.y) * scale),
      Double(face.box.width * scale),
      Double(face.box.height * scale)
    ]
    return [
      "rgb": Data(rgb).base64EncodedString(),
      "width": outSide,
      "height": outSide,
      "landmarks": landmarks,
      "box": box
    ]
  }
}
