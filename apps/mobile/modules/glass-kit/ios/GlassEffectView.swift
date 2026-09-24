import ExpoModulesCore
import UIKit

/// Fond en verre du dock (src/authentik/components/TabBar.tsx), sans enfant React (les onglets
/// sont posés par-dessus en frères) :
/// - app compilée avec le SDK iOS 26 et appareil sous iOS 26 : vrai Liquid Glass (`UIGlassEffect`)
///   — réfraction et reflets dynamiques, adaptation clair/sombre au contenu défilant dessous, ombre
///   et liseré dessinés par le système ;
/// - sinon : flou système très fin, voile léger, reflet haut, liseré lumineux dégradé et ombre
///   portée limitée à l'extérieur du verre (sous un verre translucide, elle le salirait).
/// `#if compiler(>=6.2)` : `UIGlassEffect` n'existe pas dans les SDK antérieurs (Xcode 16), qui
/// compilent alors seulement le repli.
public final class GlassEffectView: ExpoView {
  static var liquidGlassAvailable: Bool {
    #if compiler(>=6.2)
    if #available(iOS 26.0, *) {
      return true
    }
    #endif
    return false
  }

  var glassStyle = "regular" {
    didSet {
      if oldValue != glassStyle {
        updateEffect()
      }
    }
  }
  var glassTint: UIColor? {
    didSet {
      updateEffect()
    }
  }
  var interactive = false {
    didSet {
      if oldValue != interactive {
        updateEffect()
      }
    }
  }
  var glassCornerRadius: CGFloat = 0 {
    didSet {
      setNeedsLayout()
    }
  }
  var colorScheme: String? {
    didSet {
      overrideUserInterfaceStyle = colorScheme == "dark" ? .dark : colorScheme == "light" ? .light : .unspecified
      updateEffect()
    }
  }

  private let effectView = UIVisualEffectView(effect: nil)
  // Repli (avant iOS 26) seulement.
  private let shadowLayer = CALayer()
  private let shadowMask = CAShapeLayer()
  private let veil = UIView()
  private let sheen = CAGradientLayer()
  private let rim = CAGradientLayer()
  private let rimMask = CAShapeLayer()

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    clipsToBounds = false
    isUserInteractionEnabled = false
    effectView.isUserInteractionEnabled = false

    shadowLayer.shadowColor = UIColor.black.cgColor
    shadowMask.fillRule = .evenOdd
    shadowLayer.mask = shadowMask
    layer.addSublayer(shadowLayer)

    addSubview(effectView)
    effectView.contentView.addSubview(veil)
    effectView.contentView.layer.addSublayer(sheen)

    rimMask.fillColor = UIColor.clear.cgColor
    rimMask.strokeColor = UIColor.black.cgColor
    rim.mask = rimMask
    layer.addSublayer(rim)

    updateEffect()
  }

  private var isDark: Bool {
    colorScheme == "dark" || (colorScheme == nil && traitCollection.userInterfaceStyle == .dark)
  }

  private func updateEffect() {
    #if compiler(>=6.2)
    if #available(iOS 26.0, *) {
      let glass = UIGlassEffect(style: glassStyle == "clear" ? .clear : .regular)
      glass.tintColor = glassTint
      glass.isInteractive = interactive
      effectView.effect = glass
      setFallbackHidden(true)
      return
    }
    #endif
    let dark = isDark
    effectView.effect = UIBlurEffect(style: dark ? .systemUltraThinMaterialDark : .systemUltraThinMaterialLight)
    setFallbackHidden(false)
    veil.backgroundColor = glassTint ?? UIColor.white.withAlphaComponent(dark ? 0.05 : 0.22)
    sheen.colors = [UIColor.white.withAlphaComponent(dark ? 0.12 : 0.38).cgColor, UIColor.white.withAlphaComponent(0).cgColor]
    rim.colors = [
      UIColor.white.withAlphaComponent(dark ? 0.42 : 0.9).cgColor,
      UIColor.white.withAlphaComponent(dark ? 0.06 : 0.25).cgColor,
      UIColor.white.withAlphaComponent(dark ? 0.16 : 0.5).cgColor,
    ]
    rim.locations = [0, 0.55, 1]
    shadowLayer.shadowOpacity = dark ? 0.55 : 0.16
    shadowLayer.shadowRadius = dark ? 22 : 18
    shadowLayer.shadowOffset = CGSize(width: 0, height: dark ? 12 : 9)
  }

  private func setFallbackHidden(_ hidden: Bool) {
    shadowLayer.isHidden = hidden
    veil.isHidden = hidden
    sheen.isHidden = hidden
    rim.isHidden = hidden
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    let radius = min(glassCornerRadius, min(bounds.width, bounds.height) / 2)
    effectView.frame = bounds
    effectView.layer.cornerRadius = radius
    effectView.layer.cornerCurve = .continuous
    // Le verre iOS 26 dessine son propre bord et son ombre : ne pas le rogner.
    effectView.clipsToBounds = !Self.liquidGlassAvailable && radius > 0

    CATransaction.begin()
    CATransaction.setDisableActions(true)
    veil.frame = effectView.contentView.bounds
    sheen.frame = CGRect(x: 0, y: 0, width: bounds.width, height: bounds.height * 0.5)

    let glassPath = UIBezierPath(roundedRect: bounds, cornerRadius: radius)
    shadowLayer.frame = bounds
    shadowLayer.shadowPath = glassPath.cgPath
    let outside = UIBezierPath(rect: bounds.insetBy(dx: -80, dy: -80))
    outside.append(glassPath)
    shadowMask.path = outside.cgPath

    let hairline = 1 / max(UIScreen.main.scale, 1)
    rim.frame = bounds
    rimMask.lineWidth = hairline * 2
    rimMask.path = UIBezierPath(roundedRect: bounds.insetBy(dx: hairline, dy: hairline), cornerRadius: max(0, radius - hairline)).cgPath
    CATransaction.commit()
  }

  public override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    if colorScheme == nil {
      updateEffect()
    }
  }
}
