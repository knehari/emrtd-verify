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

/** Une image suivie par ARKit (caméra TrueDepth) — voir ios/FaceLiveness.swift. */
export interface LivenessFrameEvent {
  /** Heure de capture, epoch ms (horloge de l'appareil). */
  timestamp: number;
  tracked: boolean;
  /** Identifiant du visage suivi : change si le suivi est perdu puis repris. */
  anchorId?: string;
  eyeBlinkLeft?: number;
  eyeBlinkRight?: number;
  jawOpen?: number;
  mouthSmileLeft?: number;
  mouthSmileRight?: number;
  /** Négatif = tête tournée vers la gauche du sujet. */
  headYawDegrees?: number;
  /** Couleur moyenne de la peau au centre du visage, composantes [0, 1]. */
  perceivedColor?: { r: number; g: number; b: number };
}

export type LivenessCaptureEvent = NativeFaceCrop & { request: number; anchorId: string; timestamp: number };

export interface FaceLivenessViewProps extends ViewProps {
  active?: boolean;
  captureRequest?: number;
  /** Verrouille exposition et balance des blancs (défi lumineux). */
  lockCamera?: boolean;
  onLivenessFrame?: (event: { nativeEvent: LivenessFrameEvent }) => void;
  onCaptured?: (event: { nativeEvent: LivenessCaptureEvent }) => void;
  onSessionError?: (event: { nativeEvent: { message: string } }) => void;
}

interface FaceLivenessNativeModule {
  isTrueDepthAvailable(): boolean;
}

function loadFaceLiveness(): FaceLivenessNativeModule | null {
  if (Platform.OS !== "ios") return null;
  try {
    return requireNativeModule<FaceLivenessNativeModule>("FaceLiveness");
  } catch {
    return null; // binaire compilé avant l'ajout de la vivacité active
  }
}

const FaceLiveness = loadFaceLiveness();

/** Vivacité active possible : module natif présent et caméra TrueDepth (iPhone X et suivants). */
export function isTrueDepthAvailable(): boolean {
  try {
    return FaceLiveness?.isTrueDepthAvailable() ?? false;
  } catch {
    return false;
  }
}

export const FaceLivenessView = FaceLiveness ? requireNativeViewManager<FaceLivenessViewProps>("FaceLiveness") : null;
