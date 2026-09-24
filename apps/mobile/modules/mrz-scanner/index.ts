import { requireNativeViewManager } from "expo-modules-core";
import type { ViewProps } from "react-native";

/** Ligne reconnue par Apple Vision, coordonnées normalisées [0,1] dans la vue, origine en haut à gauche. */
export interface DetectedTextLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextDetectedEvent {
  nativeEvent: { lines: DetectedTextLine[] };
}

export interface MrzScannerViewProps extends ViewProps {
  /** Arrête la session caméra quand `false` (par ex. une fois la MRZ lue). */
  active?: boolean;
  torch?: boolean;
  /** Seule cette zone de l'image est analysée (normalisée dans la vue). */
  regionOfInterest?: { x: number; y: number; width: number; height: number };
  onTextDetected?: (event: TextDetectedEvent) => void;
}

/** Disponible sur iOS uniquement (Apple Vision) — voir expo-module.config.json. */
export const MrzScannerView = requireNativeViewManager<MrzScannerViewProps>("MrzScanner");
