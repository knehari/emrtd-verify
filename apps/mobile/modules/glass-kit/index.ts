import { requireNativeModule, requireNativeViewManager } from "expo-modules-core";
import { Platform, type ViewProps } from "react-native";

export interface GlassEffectViewProps extends ViewProps {
  /** "regular" (défaut) ou "clear" (plus transparent). */
  glassStyle?: "regular" | "clear";
  glassTint?: string;
  /** iOS 26 : le verre réagit au toucher (reflet, léger gonflement). */
  interactive?: boolean;
  cornerRadius?: number;
  colorScheme?: "light" | "dark";
}

interface GlassKitNativeModule {
  isLiquidGlassAvailable(): boolean;
  glassDiagnostics?(): { compiledWithIOS26SDK: boolean; osVersion: string; liquidGlass: boolean };
}

function loadGlassKit(): GlassKitNativeModule | null {
  if (Platform.OS !== "ios") return null;
  try {
    return requireNativeModule<GlassKitNativeModule>("GlassKit");
  } catch {
    // Binaire compilé avant l'ajout de ce module : l'appelant garde son repli expo-blur.
    return null;
  }
}

const GlassKit = loadGlassKit();

/** Vrai Liquid Glass (UIGlassEffect) : SDK iOS 26 à la compilation et iOS 26 sur l'appareil. */
export const liquidGlassAvailable: boolean = GlassKit?.isLiquidGlassAvailable() ?? false;

export type GlassStatus =
  | { kind: "native" }
  | { kind: "no-module" }
  | { kind: "old-sdk" }
  | { kind: "old-ios"; osVersion: string };

/** Pourquoi le dock est (ou non) en vrai Liquid Glass — affiché dans Réglages › Apparence. */
export function glassStatus(): GlassStatus {
  if (!GlassKit) return { kind: "no-module" };
  if (liquidGlassAvailable) return { kind: "native" };
  const diagnostics = GlassKit.glassDiagnostics?.();
  if (diagnostics && !diagnostics.compiledWithIOS26SDK) return { kind: "old-sdk" };
  return { kind: "old-ios", osVersion: diagnostics?.osVersion ?? "?" };
}

/** Fond en verre natif (Liquid Glass sur iOS 26, flou fin + liseré avant) — `null` si le module manque. */
export const GlassEffectView = GlassKit ? requireNativeViewManager<GlassEffectViewProps>("GlassKit") : null;

export interface GlassTabBarProps extends ViewProps {
  titles: string[];
  /** Noms de SF Symbols, un par onglet. */
  symbols: string[];
  /** -1 : aucun onglet sélectionné. */
  selectedIndex: number;
  accentColor?: string;
  colorScheme?: "light" | "dark";
  haptics?: boolean;
  onSelect?: (event: { nativeEvent: { index: number } }) => void;
}

function loadGlassTabBar() {
  if (!liquidGlassAvailable) return null;
  try {
    requireNativeModule("GlassTabBar");
    return requireNativeViewManager<GlassTabBarProps>("GlassTabBar");
  } catch {
    return null; // binaire sans ce module : dock React Native sur fond de verre
  }
}

/** Dock natif SwiftUI en Liquid Glass (iOS 26 uniquement) — `null` sinon. */
export const GlassTabBar = loadGlassTabBar();

