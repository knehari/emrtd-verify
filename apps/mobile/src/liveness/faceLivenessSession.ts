import { FaceLivenessSessionUnavailableError, createMockFaceLivenessSession, type FaceLivenessSession } from "@emrtd-verify/emrtd-core";

/**
 * Frontière de capture réelle (ARKit TrueDepth) côté iOS — voir
 * packages/emrtd-core/src/liveness/session.ts `FaceLivenessSession` pour l'interface à respecter,
 * et docs/facial-recognition.md "Détection de vivacité active" pour le choix technologique
 * (ARFaceTrackingConfiguration/ARFaceAnchor.blendShapes, seule techno grand public produisant une
 * carte de profondeur 3D réelle, structurellement non reproductible par une photo/vidéo 2D).
 *
 * La capture réelle existe désormais sous une autre forme que cette interface à session : la vue
 * native `FaceLivenessView` (modules/face-kit/ios/FaceLiveness.swift, ARKit) et l'enregistreur pur
 * `ActiveLivenessRecorder` (./activeLiveness.ts), utilisés par l'écran selfie de l'app Authentik
 * (authentik/screens/SelfieScreen.tsx). Cette fonction reste pour l'ancien écran
 * LivenessChallengeScreen, qui n'a pas de vue caméra où afficher ARKit.
 */
export function createFaceLivenessSession(): FaceLivenessSession {
  throw new FaceLivenessSessionUnavailableError(
    "Capture ARKit disponible uniquement via la vue FaceLivenessView (écran selfie de l'app Authentik, voir ./activeLiveness.ts) — pas via cette interface à session. Utiliser createMockFaceLivenessSession() (@emrtd-verify/emrtd-core) pour cet écran de développement.",
  );
}

/**
 * Réexport explicite pour le développement/les tests d'intégration de l'écran (voir
 * LivenessChallengeScreen.tsx) — produit des échantillons SYNTHÉTIQUES, jamais une preuve réelle
 * de vivacité. Ne jamais utiliser en dehors d'un build de développement.
 */
export { createMockFaceLivenessSession, FaceLivenessSessionUnavailableError };
export type { FaceLivenessSession };
