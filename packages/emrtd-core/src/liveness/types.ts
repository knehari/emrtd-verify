/**
 * Détection de vivacité ACTIVE — protocole de challenge-réponse à séquence d'actions aléatoire,
 * conçu pour être exécuté côté mobile avec une source de données 3D (ARKit TrueDepth sur iOS,
 * `ARFaceAnchor.blendShapes` — seule techno grand public qui produit une carte de profondeur
 * réelle, donc structurellement non reproductible par une photo/vidéo/écran rejoué en 2D) puis
 * vérifié côté serveur. Voir docs/facial-recognition.md "Détection de vivacité active" pour le
 * périmètre exact (ce que ce protocole protège, et ce qu'il NE protège PAS — notamment un deepfake
 * piloté en temps réel par un opérateur humain, scénario distinct identifié par l'ENISA).
 */

export type LivenessActionType = "blink" | "turn_head_left" | "turn_head_right" | "open_mouth" | "smile";

export const LIVENESS_ACTION_TYPES: readonly LivenessActionType[] = [
  "blink",
  "turn_head_left",
  "turn_head_right",
  "open_mouth",
  "smile",
];

export interface LivenessChallengeStep {
  action: LivenessActionType;
  /** Millisecondes relatives à `LivenessChallenge.issuedAt`. */
  windowStartMs: number;
  windowEndMs: number;
}

export interface LivenessChallenge {
  /** Identifiant unique de ce challenge — usage prévu : détection de rejeu côté serveur (cache des nonces déjà consommés), non implémenté ici (voir apps/api). */
  nonce: string;
  steps: LivenessChallengeStep[];
  issuedAt: number; // epoch ms
  expiresAt: number; // epoch ms
}

/**
 * Un échantillon des coefficients de forme faciale capturés à un instant donné (nommage aligné sur
 * `ARFaceAnchor.blendShapes` d'ARKit, mais le type reste indépendant de toute plateforme — voir
 * session.ts `FaceLivenessSession` pour la frontière de capture). Uniquement les coefficients
 * utilisés par ce protocole : pas de coordonnées de visage brutes, pas de maillage 3D complet, pas
 * d'image — minimisation RGPD (voir docs/facial-recognition.md).
 */
export interface LivenessSignalFrame {
  timestamp: number; // epoch ms
  eyeBlinkLeft: number; // [0, 1]
  eyeBlinkRight: number; // [0, 1]
  jawOpen: number; // [0, 1]
  mouthSmileLeft: number; // [0, 1]
  mouthSmileRight: number; // [0, 1]
  /** Lacet de la tête en degrés ; négatif = tourné à gauche du point de vue du sujet, positif = à droite. */
  headYawDegrees: number;
}

export interface LivenessStepVerification {
  action: LivenessActionType;
  satisfied: boolean;
  reason?: string;
  riseDurationMs?: number;
}

export interface LivenessVerificationResult {
  passed: boolean;
  steps: LivenessStepVerification[];
  /** Raisons globales d'échec (non rattachées à une étape précise : challenge expiré, horodatages incohérents, minutage suspect). */
  reasons: string[];
}
