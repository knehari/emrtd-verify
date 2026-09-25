import ExpoModulesCore
import SwiftUI
import UIKit

/// Dock entièrement natif pour iOS 26 (src/authentik/components/TabBar.tsx) : barre en Liquid Glass
/// SwiftUI (`glassEffect(.regular.interactive())`), icônes SF Symbols, pastille de sélection qui
/// glisse d'un onglet à l'autre (`matchedGeometryEffect`) et retour haptique de sélection — le
/// rendu et les réactions au toucher sont ceux du système, rien n'est imité. Avant iOS 26 (ou
/// compilé sans le SDK iOS 26), la vue reste vide et le JS garde son dock React Native.
public final class GlassTabBarModule: Module {
  public func definition() -> ModuleDefinition {
    Name("GlassTabBar")

    View(GlassTabBarView.self) {
      Events("onSelect")

      Prop("titles") { (view: GlassTabBarView, titles: [String]?) in
        view.model.titles = titles ?? []
      }
      /// Noms de SF Symbols, un par onglet.
      Prop("symbols") { (view: GlassTabBarView, symbols: [String]?) in
        view.model.symbols = symbols ?? []
      }
      /// -1 : aucun onglet sélectionné.
      Prop("selectedIndex") { (view: GlassTabBarView, index: Int?) in
        view.model.selectedIndex = index ?? -1
      }
      Prop("accentColor") { (view: GlassTabBarView, color: UIColor?) in
        view.model.accent = color ?? .systemBlue
      }
      Prop("colorScheme") { (view: GlassTabBarView, scheme: String?) in
        view.model.dark = scheme != "light"
      }
      Prop("haptics") { (view: GlassTabBarView, enabled: Bool?) in
        view.model.haptics = enabled ?? true
      }
    }
  }
}

final class GlassTabBarModel: ObservableObject {
  @Published var titles: [String] = []
  @Published var symbols: [String] = []
  @Published var selectedIndex = -1
  @Published var accent: UIColor = .systemBlue
  @Published var dark = true
  @Published var haptics = true
}

public final class GlassTabBarView: ExpoView {
  let onSelect = EventDispatcher()
  let model = GlassTabBarModel()
  private var hosted: UIView?
  // Conservé : sans référence forte, le contrôleur SwiftUI serait libéré et la vue ne se mettrait plus à jour.
  private var hostingController: UIViewController?

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    clipsToBounds = false
    #if compiler(>=6.2)
    if #available(iOS 26.0, *) {
      let content = GlassTabBarContent(model: model) { [weak self] index in
        self?.onSelect(["index": index])
      }
      let hosting = UIHostingController(rootView: content)
      hosting.view.backgroundColor = .clear
      hosting.view.clipsToBounds = false
      // Le dock est déjà placé au-dessus de l'indicateur d'accueil par le JS.
      hosting.safeAreaRegions = []
      addSubview(hosting.view)
      hosted = hosting.view
      hostingController = hosting
    }
    #endif
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    hosted?.frame = bounds
  }
}

#if compiler(>=6.2)
@available(iOS 26.0, *)
struct GlassTabBarContent: View {
  @ObservedObject var model: GlassTabBarModel
  let onSelect: (Int) -> Void
  @Namespace private var selection

  var body: some View {
    let accent = Color(uiColor: model.accent)
    HStack(spacing: 0) {
      ForEach(Array(model.titles.enumerated()), id: \.offset) { index, title in
        let selected = index == model.selectedIndex
        Button {
          onSelect(index)
        } label: {
          VStack(spacing: 3) {
            Image(systemName: index < model.symbols.count ? model.symbols[index] : "circle")
              .font(.system(size: 20, weight: .medium))
              .frame(height: 24)
            Text(title)
              .font(.system(size: 10.5, weight: .medium))
              .lineLimit(1)
          }
          .foregroundStyle(selected ? accent : Color.primary.opacity(0.6))
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background {
            if selected {
              Capsule()
                .fill(Color.primary.opacity(model.dark ? 0.14 : 0.08))
                .matchedGeometryEffect(id: "selection", in: selection)
            }
          }
          .contentShape(Capsule())
        }
        .buttonStyle(.plain)
      }
    }
    .padding(7)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .glassEffect(.regular.interactive(), in: .capsule)
    .animation(.spring(response: 0.36, dampingFraction: 0.78), value: model.selectedIndex)
    .sensoryFeedback(.selection, trigger: model.selectedIndex) { _, _ in model.haptics }
    .environment(\.colorScheme, model.dark ? .dark : .light)
  }
}
#endif
