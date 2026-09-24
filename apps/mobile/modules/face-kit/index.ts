import { requireNativeModule, requireNativeViewManager } from "expo-modules-core";
import { Platform, type ViewProps } from "react-native";
import type { NativeFaceCrop } from "../../src/faceMatch/faceCrop";

/** Une image analysée du flux caméra frontale. Coordonnées normalisées [0,1], image non miroir. */
export interface FaceFrame {
  faceCount: number;
  timestamp: number;
  box?: { x: number; y: number; width: number; height: number };
  /** Décalage du nez / milieu des yeux, en distances inter-oculaires (~0 de face). */
  turn?: number;
  /** Hauteur / largeur moyenne du contour des yeux (chute pendant un clignement). */
  eyeOpenness?: number;
}

export interface FaceCaptureViewProps extends ViewProps {
  active?: boolean;
  /** Incrémenter pour obtenir le recadrage de la prochaine image à visage unique (`onCaptured`). */
  captureRequest?: number;
  onFaceFrame?: (event: { nativeEvent: FaceFrame }) => void;
  onCaptured?: (event: { nativeEvent: NativeFaceCrop & { request: number } }) => void;
}

interface FaceKitNativeModule {
  /** Photo (JPEG / JPEG 2000) en base64 → recadrage du plus grand visage. Rejette sans visage. */
  detectFaceInImage(base64: string): Promise<NativeFaceCrop>;
}

function loadFaceKit(): FaceKitNativeModule | null {
  if (Platform.OS !== "ios") return null;
  try {
    return requireNativeModule<FaceKitNativeModule>("FaceKit");
  } catch {
    // Binaire compilé avant l'ajout de ce module : pas de selfie plutôt qu'un plantage au lancement.
    return null;
  }
}

/** iOS uniquement (Apple Vision) — `null` ailleurs ou si le binaire ne contient pas le module. */
export const FaceKit = loadFaceKit();
export const FaceCaptureView = FaceKit ? requireNativeViewManager<FaceCaptureViewProps>("FaceKit") : null;
