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
} as const;

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
