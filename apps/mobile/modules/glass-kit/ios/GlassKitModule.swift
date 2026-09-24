import ExpoModulesCore
import UIKit

public final class GlassKitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("GlassKit")

    /// Vrai Liquid Glass disponible : app compilée avec le SDK iOS 26 ET appareil sous iOS 26.
    Function("isLiquidGlassAvailable") { () -> Bool in
      GlassEffectView.liquidGlassAvailable
    }

    View(GlassEffectView.self) {
      /// "regular" (défaut) ou "clear" (plus transparent, pour un fond riche).
      Prop("glassStyle") { (view: GlassEffectView, style: String?) in
        view.glassStyle = style ?? "regular"
      }
      Prop("glassTint") { (view: GlassEffectView, color: UIColor?) in
        view.glassTint = color
      }
      Prop("interactive") { (view: GlassEffectView, interactive: Bool?) in
        view.interactive = interactive ?? false
      }
      Prop("cornerRadius") { (view: GlassEffectView, radius: Double?) in
        view.glassCornerRadius = CGFloat(radius ?? 0)
      }
      /// "dark" / "light" : suit le thème de l'app, indépendant du réglage système.
      Prop("colorScheme") { (view: GlassEffectView, scheme: String?) in
        view.colorScheme = scheme
      }
    }
  }
}
