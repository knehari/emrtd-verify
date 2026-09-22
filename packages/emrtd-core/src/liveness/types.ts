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
  /** Identifiant unique de ce challenge — consommé une seule fois côté serveur, voir apps/api `LivenessReplayGuardService`. */
  nonce: string;
  steps: LivenessChallengeStep[];
  /** Présent uniquement pour les politiques de risque qui l'exigent (voir challenge.ts `generateLivenessChallenge` `requireLightChallenge`) — canal indépendant des actions faciales. */
  lightSequence?: LightChallengeStep[];
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
  /** Position dans la séquence, à partir de 0 — voir frameIntegrity.ts. Doit être strictement croissante sans lacune : une frame manquante, dupliquée ou réordonnée casse la chaîne. */
  frameIndex: number;
  /** SHA-256 hex de cette frame chaînée à la précédente (voir `computeFrameHash`/`chainFrames`, frameIntegrity.ts) — rend toute substitution/insertion/réordonnancement après coup détectable côté serveur, même principe que le compteur SSC de la messagerie sécurisée BAC (nfc/secureMessaging.ts). */
  frameHash: string;
}

/**
 * Séquence lumineuse aléatoire pilotée par l'écran (voir liveness/challenge.ts
 * `generateLivenessChallenge`) — canal indépendant des actions faciales : le serveur fait
 * varier la couleur/intensité affichée à l'écran, la capture doit rapporter la lumière
 * perçue/reflétée en conséquence. Une vidéo pré-enregistrée ne peut pas anticiper une séquence
 * générée après le début de la session.
 */
export interface LightChallengeStep {
  /** Millisecondes relatives à `LivenessChallenge.issuedAt`, indépendantes des fenêtres d'action. */
  atMs: number;
  /** Couleur affichée à pleine luminosité de l'écran, composantes [0, 1]. */
  color: { r: number; g: number; b: number };
}

/** Échantillon de lumière perçue/reflétée rapporté par la capture, en réponse à `LightChallengeStep`. */
export interface LightSignalSample {
  timestamp: number; // epoch ms
  /** Couleur perçue (ex. reflet cornéen/peau), composantes [0, 1] — mêmes conventions que `LightChallengeStep.color`. */
  perceivedColor: { r: number; g: number; b: number };
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
  /** Chaîne de hachage des frames intacte (voir frameIntegrity.ts) — false si une frame a été substituée, réordonnée ou insérée après coup. */
  frameChainIntact: boolean;
  /** Présent uniquement si `LivenessChallenge.lightSequence` a été fourni — voir verifyLightChallenge (verify.ts). */
  lightChallengePassed?: boolean;
  /** Raisons globales d'échec (non rattachées à une étape précise : challenge expiré, horodatages incohérents, minutage suspect, chaîne de frames rompue, challenge lumineux non corrélé). */
  reasons: string[];
}
