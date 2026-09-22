import type { LivenessActionType, LivenessChallenge, LivenessChallengeStep, LightChallengeStep } from "./types";
import { LIVENESS_ACTION_TYPES } from "./types";

export interface GenerateLivenessChallengeOptions {
  now?: number;
  /** Nombre d'actions demandées (2-5, bornées par la taille de LIVENESS_ACTION_TYPES). Par défaut 3 : un compromis entre robustesse (plus d'actions = plus difficile à deviner/rejouer) et durée d'expérience utilisateur. */
  stepCount?: number;
  /** Ajoute un canal indépendant de challenge lumineux (voir verifyLightChallenge, verify.ts) — recommandé pour les politiques de risque élevées (voir apps/api `LivenessChallengeService`, adapté au risque client). Par défaut désactivé : nécessite un contrôle de l'écran ET une lecture de la lumière perçue côté capture, non disponible tant que le module natif ARKit n'est pas écrit (voir apps/mobile/src/liveness/faceLivenessSession.ts). */
  requireLightChallenge?: boolean;
  /** Source d'aléa injectable — permet des tests déterministes et reste portable React Native (voir defaultRandomBytes ci-dessous, même contrainte que nfc/bac.ts `generateRandomBytes`). */
  randomBytes?: (length: number) => Uint8Array;
}

const STEP_WINDOW_DURATION_MS = 2500;
const STEP_GAP_MS = 500;
// Marge large après la dernière fenêtre d'action : couvre latence réseau mobile + temps de
// soumission de la réponse, sans viser une valeur calibrée sur des captures réelles (à ajuster
// avant tout déploiement en production, même logique que BLUR_VARIANCE_THRESHOLD dans
// services/face-match/app/liveness.py).
const SUBMISSION_GRACE_PERIOD_MS = 15_000;

function defaultRandomBytes(length: number): Uint8Array {
  if (typeof globalThis.crypto?.getRandomValues === "undefined") {
    throw new Error(
      "crypto.getRandomValues indisponible : requis pour générer le nonce/la séquence du challenge de liveness active. Sur React Native, importer `react-native-get-random-values` avant tout appel à generateLivenessChallenge (voir apps/mobile, même contrainte que performBacHandshake).",
    );
  }
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function pickDistinctActions(count: number, randomBytes: (length: number) => Uint8Array): LivenessActionType[] {
  const pool = [...LIVENESS_ACTION_TYPES];
  const picked: LivenessActionType[] = [];
  const boundedCount = Math.min(count, pool.length);
  for (let i = 0; i < boundedCount; i++) {
    const randomIndexByte = randomBytes(1)[0];
    const index = randomIndexByte % pool.length;
    picked.push(pool[index]);
    pool.splice(index, 1);
  }
  return picked;
}

// Intervalle entre deux changements de couleur : ~0.67 Hz, largement sous le seuil de 3 Hz cité par
// les recommandations de sécurité visuelle pour le contenu clignotant (WCAG 2.3.1). Intensité
// modérée (0.85, pas 1.0) plutôt qu'un plein blanc/couleur pure — confort visuel, pas un flash.
const LIGHT_STEP_INTERVAL_MS = 1500;
const LIGHT_STEP_INTENSITY = 0.85;
const LIGHT_STEP_LOW_CHANNEL = 0.05;
const LIGHT_COLOR_PALETTE: ReadonlyArray<{ r: number; g: number; b: number }> = [
  { r: LIGHT_STEP_INTENSITY, g: LIGHT_STEP_LOW_CHANNEL, b: LIGHT_STEP_LOW_CHANNEL }, // rouge
  { r: LIGHT_STEP_LOW_CHANNEL, g: LIGHT_STEP_INTENSITY, b: LIGHT_STEP_LOW_CHANNEL }, // vert
  { r: LIGHT_STEP_LOW_CHANNEL, g: LIGHT_STEP_LOW_CHANNEL, b: LIGHT_STEP_INTENSITY }, // bleu
  { r: LIGHT_STEP_INTENSITY, g: LIGHT_STEP_INTENSITY, b: LIGHT_STEP_LOW_CHANNEL }, // jaune
  { r: LIGHT_STEP_INTENSITY, g: LIGHT_STEP_LOW_CHANNEL, b: LIGHT_STEP_INTENSITY }, // magenta
  { r: LIGHT_STEP_LOW_CHANNEL, g: LIGHT_STEP_INTENSITY, b: LIGHT_STEP_INTENSITY }, // cyan
];

/** Séquence de couleurs aléatoire et imprévisible, indépendante des fenêtres d'action — voir `LightChallengeStep`. Jamais deux couleurs consécutives identiques (garantit une variation mesurable, voir verify.ts "light_challenge_perceived_color_static"). */
function generateLightSequence(totalDurationMs: number, randomBytes: (length: number) => Uint8Array): LightChallengeStep[] {
  const steps: LightChallengeStep[] = [];
  let previousColorIndex = -1;
  for (let atMs = 0; atMs <= totalDurationMs; atMs += LIGHT_STEP_INTERVAL_MS) {
    let colorIndex = randomBytes(1)[0] % LIGHT_COLOR_PALETTE.length;
    if (colorIndex === previousColorIndex) {
      colorIndex = (colorIndex + 1) % LIGHT_COLOR_PALETTE.length;
    }
    steps.push({ atMs, color: LIGHT_COLOR_PALETTE[colorIndex] });
    previousColorIndex = colorIndex;
  }
  return steps;
}

/**
 * Génère un challenge de liveness active : une séquence ALÉATOIRE et IMPRÉVISIBLE d'actions
 * (clignement, rotation de tête, ouverture de bouche, sourire), chacune assignée à une fenêtre
 * temporelle précise et non chevauchante. L'imprévisibilité de l'ordre est la propriété de
 * sécurité centrale : une attaque par rejeu (photo, vidéo pré-enregistrée, deepfake pré-rendu) ne
 * peut pas connaître à l'avance quelle action est demandée ni à quel instant — voir verify.ts pour
 * la vérification correspondante, et docs/facial-recognition.md pour le périmètre exact de ce que
 * ce protocole protège (et ne protège pas).
 *
 * Ce challenge doit être signé/authentifié par le serveur avant d'être transmis au mobile (pour
 * empêcher un client malveillant de forger ses propres fenêtres temporelles), voir la future
 * LivenessChallengeService dans apps/api — non implémenté dans ce module, qui reste
 * intentionnellement indépendant de toute infrastructure serveur (mêmes principes de séparation
 * que packages/emrtd-core/src/nfc/bac.ts, testable sans réseau ni matériel).
 */
export function generateLivenessChallenge(options: GenerateLivenessChallengeOptions = {}): LivenessChallenge {
  const now = options.now ?? Date.now();
  const stepCount = options.stepCount ?? 3;
  const randomBytes = options.randomBytes ?? defaultRandomBytes;

  const actions = pickDistinctActions(stepCount, randomBytes);
  const steps: LivenessChallengeStep[] = actions.map((action, index) => {
    const windowStartMs = index * (STEP_WINDOW_DURATION_MS + STEP_GAP_MS);
    return { action, windowStartMs, windowEndMs: windowStartMs + STEP_WINDOW_DURATION_MS };
  });

  const totalDurationMs = steps.length > 0 ? steps[steps.length - 1].windowEndMs : 0;

  return {
    nonce: bytesToHex(randomBytes(16)),
    steps,
    lightSequence: options.requireLightChallenge ? generateLightSequence(totalDurationMs, randomBytes) : undefined,
    issuedAt: now,
    expiresAt: now + totalDurationMs + SUBMISSION_GRACE_PERIOD_MS,
  };
}
