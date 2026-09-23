/**
 * Design tokens "Authentik" — transcrits verbatim depuis le handoff de design
 * (`design_handoff_authentik/README.md` §9 "Design tokens"), fourni par l'utilisateur comme
 * référence haute-fidélité pour l'application mobile. Voir aussi state.ts (logique/état,
 * transcrite depuis la `class Component` du prototype HTML) et copy.ts (texte FR/EN verbatim).
 *
 * Différences volontaires par rapport au prototype HTML (qui tournait dans un mockup de téléphone
 * dessiné en CSS, à l'intérieur d'un navigateur) : ici l'app tourne plein écran sur un vrai
 * appareil, donc pas de "notch" ni de home indicator dessinés à la main — voir SafeAreaView/
 * useSafeAreaInsets dans AuthentikApp.tsx pour l'équivalent natif.
 */

export const colors = {
  accent: "#0A84FF",
  accentPressed: "#0060DF",
  gradientTop: "#3AA0FF",
  gradientMid: "#0A84FF",
  gradientBottom: "#0060DF",
  success: "#30D158",
  warning: "#FF9F0A",
  error: "#FF3B30",
  neutralInfo: "#8E8E93",
  inkPrimary: "#000000",
  inkVerdict: "#1a1a1a",
  inkSecondary: "rgba(60,60,67,0.6)",
  inkTertiary: "rgba(60,60,67,0.5)",
  inkFaint: "rgba(60,60,67,0.3)",
  chevron: "rgba(60,60,67,0.3)",
  screenLight: "#F2F2F7",
  surface: "#FFFFFF",
  screenDark: "#0B0B0C",
  darkSurface1: "#1C1C1E",
  darkSurface2: "#232326",
  darkSurface3: "#2A2A2E",
  separator: "rgba(60,60,67,0.18)",
  separatorFaint: "rgba(60,60,67,0.16)",
  washGreenBg: "#EAF9EE",
  washGreenBorder: "rgba(48,209,88,0.3)",
  washGreenInk: "#1F7A38",
  washOrangeBg: "#FFF6E6",
  washOrangeBorder: "rgba(255,159,10,0.3)",
  washOrangeInk: "#B36A00",
  washRedBg: "#FDECEB",
  washRedBorder: "rgba(255,59,48,0.28)",
  washRedInk: "#B3261E",
  searchField: "rgba(118,118,128,0.12)",
  switchTrackInactive: "rgba(120,120,128,0.22)",
  switchTrackActive: "#30D158",
  nfcDigit: "#0A2540",
  /** Triplet RGB (sans alpha) de `inkPrimary`/`inkSecondary`/etc., pour composer des `rgba(...)`
   * ad hoc à la même opacité que ces tokens sans dupliquer le triplet en dur à chaque usage —
   * voir `darkColors` ci-dessous, où ce triplet devient blanc plutôt que noir. */
  inkBaseRgb: "60,60,67",
} as const;

/** Mode Dark — n'existe pas dans le handoff de design original (aucune maquette sombre livrée),
 * ajouté sur demande de l'utilisateur. Ne redéfinit QUE les tokens dont le rôle est "s'adapter au
 * fond" (encre/surfaces/séparateurs/washs) ; `accent`, les dégradés et les couleurs sémantiques
 * (succès/avertissement/erreur) restent identiques — déjà conçues pour rester lisibles sur les
 * deux fonds. Approximation raisonnable des conventions de couleur système iOS en mode sombre
 * (labelColor blanc à opacité dégressive, systemBackground/secondarySystemBackground), pas une
 * spec fournie par le design handoff. */
export type PaletteColors = { [K in keyof typeof colors]: string };

export const darkColors: PaletteColors = {
  ...colors,
  inkPrimary: "#FFFFFF",
  inkVerdict: "#FFFFFF",
  inkSecondary: "rgba(235,235,245,0.6)",
  inkTertiary: "rgba(235,235,245,0.5)",
  inkFaint: "rgba(235,235,245,0.3)",
  chevron: "rgba(235,235,245,0.3)",
  screenLight: "#000000",
  surface: "#1C1C1E",
  separator: "rgba(84,84,88,0.6)",
  separatorFaint: "rgba(84,84,88,0.5)",
  washGreenBg: "rgba(48,209,88,0.16)",
  washGreenBorder: "rgba(48,209,88,0.4)",
  washGreenInk: "#30D158",
  washOrangeBg: "rgba(255,159,10,0.16)",
  washOrangeBorder: "rgba(255,159,10,0.4)",
  washOrangeInk: "#FF9F0A",
  washRedBg: "rgba(255,59,48,0.16)",
  washRedBorder: "rgba(255,59,48,0.4)",
  washRedInk: "#FF453A",
  searchField: "rgba(118,118,128,0.24)",
  nfcDigit: "#FFFFFF",
  inkBaseRgb: "235,235,245",
};

export type ColorScheme = "light" | "dark";

export function paletteFor(scheme: ColorScheme): PaletteColors {
  return scheme === "dark" ? darkColors : colors;
}

/** `Menlo` est disponible nativement sur iOS pour toute donnée technique (codes DG, MRZ, sujets de certificat, valeurs de champs). */
export const fontMono = "Menlo";

export const spacing = {
  screenPadding: 20,
  tabBarClearance: 104,
} as const;

export const radius = {
  flag: 3,
  thumbnail: 8,
  search: 11,
  card: 14,
  cardLg: 16,
  verdictCard: 18,
  tabPill: 24,
  tabBar: 31,
  viewfinder: 42,
} as const;

export const OK = colors.success;
export const WARN = colors.warning;
export const INFO = colors.neutralInfo;
export const RED = colors.error;
