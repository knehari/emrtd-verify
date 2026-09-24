import ExpoModulesCore

public final class MrzScannerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MrzScanner")

    View(MrzScannerView.self) {
      Events("onTextDetected")

      Prop("active") { (view, active: Bool?) in
        view.setActive(active ?? true)
      }

      Prop("torch") { (view, torch: Bool?) in
        view.setTorch(torch ?? false)
      }

      Prop("documentFormat") { (view, format: DocumentFormat?) in
        view.setDocumentFormat(format ?? .td1)
      }

      Prop("regionOfInterest") { (view, region: RegionOfInterest?) in
        guard let region else {
          return
        }
        view.setRegionOfInterest(CGRect(x: region.x, y: region.y, width: region.width, height: region.height))
      }
    }
  }
}

/// Zone analysée, normalisée dans la vue (origine en haut à gauche).
struct RegionOfInterest: Record {
  @Field var x: Double = 0
  @Field var y: Double = 0
  @Field var width: Double = 1
  @Field var height: Double = 1
}
