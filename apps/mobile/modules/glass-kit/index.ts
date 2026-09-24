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

/** Fond en verre natif (Liquid Glass sur iOS 26, flou fin + liseré avant) — `null` si le module manque. */
export const GlassEffectView = GlassKit ? requireNativeViewManager<GlassEffectViewProps>("GlassKit") : null;
