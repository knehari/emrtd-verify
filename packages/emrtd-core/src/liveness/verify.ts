import type {
  LightSignalSample,
  LivenessActionType,
  LivenessChallenge,
  LivenessChallengeStep,
  LivenessSignalFrame,
  LivenessStepVerification,
  LivenessVerificationResult,
} from "./types";
import { verifyFrameChain } from "./frameIntegrity";

/**
 * Vérification du protocole de challenge-réponse de liveness active (voir challenge.ts). Pure,
 * sans dépendance réseau/plateforme — testable avec des séries temporelles synthétiques, même
 * approche que packages/emrtd-core/src/nfc/bac.ts (simulation de puce indépendante). Ce module ne
 * fait AUCUNE hypothèse sur la source des échantillons (ARKit ou autre) : il opère uniquement sur
 * `LivenessSignalFrame`/`LightSignalSample`, la frontière de capture étant définie dans session.ts.
 *
 * Périmètre honnête (voir docs/facial-recognition.md) : ce protocole détecte qu'une action précise
 * a été exécutée dans une fenêtre temporelle imprévisible à l'avance, avec une dynamique de montée
 * plausible, que la séquence d'échantillons capturés n'a pas été altérée après coup (chaîne de
 * hachage des frames), et — si demandé — qu'une séquence lumineuse imprévisible affichée à l'écran
 * est correctement reflétée dans la capture. Combiné à une source de données 3D réelle (ARKit
 * TrueDepth) côté capture, cela élimine structurellement une photo, une vidéo pré-enregistrée ou un
 * deepfake pré-rendu rejoués face à la caméra. Cela ne prétend PAS détecter un deepfake piloté en
 * temps réel par un opérateur humain qui répondrait spontanément au challenge (scénario distinct
 * identifié par l'ENISA, qui nécessite des mesures complémentaires — attestation d'intégrité de
 * l'application/l'appareil, voir deviceAttestation.ts, et revue humaine).
 */

export const LIVENESS_BASELINE_THRESHOLD = 0.15;
export const LIVENESS_ACTIVATION_THRESHOLD = 0.55;
/** Plus rapide qu'un clignement humain réel (~100-400ms) : une montée plus rapide que ce seuil trahit une injection directe de valeur plutôt qu'un mouvement capturé frame par frame. */
export const LIVENESS_MIN_RISE_DURATION_MS = 80;
const HEAD_TURN_ACTIVATION_DEGREES = 25;
const DEFAULT_MAX_TIMESTAMP_SKEW_MS = 2000;
/** Tolérance de comparaison pour détecter un minutage "trop parfait" entre étapes (signal probable de génération synthétique plutôt que de capture réelle). */
const UNIFORM_TIMING_TOLERANCE_MS = 5;
const MIN_STEPS_FOR_UNIFORM_TIMING_CHECK = 3;

export interface VerifyLivenessOptions {
  now?: number;
  maxTimestampSkewMs?: number;
}

/** Réponse soumise par le mobile — samples (canal actions faciales) obligatoire, lightSamples (canal challenge lumineux) requis uniquement si `challenge.lightSequence` a été émis. */
export interface LivenessResponsePayload {
  samples: LivenessSignalFrame[];
  lightSamples?: LightSignalSample[];
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function actionActivation(action: LivenessActionType, frame: LivenessSignalFrame): number {
  switch (action) {
    case "blink":
      return Math.max(frame.eyeBlinkLeft, frame.eyeBlinkRight);
    case "open_mouth":
      return frame.jawOpen;
    case "smile":
      return Math.max(frame.mouthSmileLeft, frame.mouthSmileRight);
    case "turn_head_left":
      return clamp01(-frame.headYawDegrees / HEAD_TURN_ACTIVATION_DEGREES);
    case "turn_head_right":
      return clamp01(frame.headYawDegrees / HEAD_TURN_ACTIVATION_DEGREES);
  }
}

interface StepCheckOutcome {
  satisfied: boolean;
  reason?: string;
  riseDurationMs?: number;
}

/**
 * Une étape est satisfaite si, DANS sa fenêtre, un échantillon sous le seuil de repos est suivi
 * (plus tard, dans la même fenêtre) d'un échantillon au-dessus du seuil d'activation — preuve d'un
 * mouvement réellement survenu pendant la fenêtre assignée, pas d'une valeur déjà haute en
 * permanence (ex. bouche déjà ouverte avant même le début du challenge).
 */
function verifyStep(step: LivenessChallengeStep, samples: LivenessSignalFrame[], issuedAt: number): StepCheckOutcome {
  const windowStart = issuedAt + step.windowStartMs;
  const windowEnd = issuedAt + step.windowEndMs;
  const windowSamples = samples.filter((s) => s.timestamp >= windowStart && s.timestamp <= windowEnd);

  if (windowSamples.length === 0) {
    return { satisfied: false, reason: `${step.action}_no_samples_in_window` };
  }

  let baselineTimestamp: number | undefined;
  let riseTimestamp: number | undefined;
  for (const sample of windowSamples) {
    const activation = actionActivation(step.action, sample);
    if (riseTimestamp !== undefined) break;
    if (activation < LIVENESS_BASELINE_THRESHOLD && baselineTimestamp === undefined) {
      baselineTimestamp = sample.timestamp;
    }
    if (activation >= LIVENESS_ACTIVATION_THRESHOLD && baselineTimestamp !== undefined) {
      riseTimestamp = sample.timestamp;
    }
  }

  if (baselineTimestamp === undefined || riseTimestamp === undefined) {
    return { satisfied: false, reason: `${step.action}_not_detected_in_window` };
  }

  const riseDurationMs = riseTimestamp - baselineTimestamp;
  if (riseDurationMs < LIVENESS_MIN_RISE_DURATION_MS) {
    return { satisfied: false, reason: `${step.action}_rise_too_fast_suspect_injection`, riseDurationMs };
  }

  return { satisfied: true, riseDurationMs };
}

const LIGHT_CHALLENGE_WINDOW_MS = 500;
/** Similarité cosinus minimale entre la couleur émise et la couleur perçue rapportée — une "réponse" de capture RGB réelle sur peau/yeux n'est jamais un miroir parfait de la couleur écran, d'où un seuil tolérant plutôt qu'une égalité stricte. */
export const LIGHT_CHALLENGE_MIN_COLOR_SIMILARITY = 0.7;
/** Au-delà de cette similarité, deux couleurs sont considérées "quasi identiques" pour la détection d'un signal figé (voir "light_challenge_perceived_color_static" ci-dessous). */
const LIGHT_CHALLENGE_STATIC_SIMILARITY_THRESHOLD = 0.995;

type RgbColor = { r: number; g: number; b: number };

function colorSimilarity(a: RgbColor, b: RgbColor): number {
  const dot = a.r * b.r + a.g * b.g + a.b * b.b;
  const normA = Math.sqrt(a.r ** 2 + a.g ** 2 + a.b ** 2);
  const normB = Math.sqrt(b.r ** 2 + b.g ** 2 + b.b ** 2);
  if (normA === 0 || normB === 0) return 0;
  return dot / (normA * normB);
}

export interface LightChallengeVerification {
  passed: boolean;
  reasons: string[];
}

/**
 * Vérifie que la lumière perçue/reflétée rapportée par la capture corrèle avec la séquence de
 * couleurs affichée à l'écran (voir challenge.ts `generateLightSequence`). Absence de
 * `challenge.lightSequence` → canal non requis pour ce challenge, toujours `passed: true`. Rejette :
 * aucun échantillon proche d'une étape, une couleur perçue trop éloignée de la couleur émise, et
 * une couleur perçue qui reste figée alors que la séquence émise varie significativement (signal
 * de capteur non réactif/valeur copiée-collée plutôt que d'une vraie réflexion lumineuse).
 */
export function verifyLightChallenge(challenge: LivenessChallenge, lightSamples: LightSignalSample[]): LightChallengeVerification {
  const lightSequence = challenge.lightSequence;
  if (!lightSequence || lightSequence.length === 0) {
    return { passed: true, reasons: [] };
  }

  const reasons: string[] = [];
  if (lightSamples.length === 0) {
    return { passed: false, reasons: ["light_challenge_no_samples"] };
  }

  const matchedPerceivedColors: RgbColor[] = [];
  for (const step of lightSequence) {
    const targetTimestamp = challenge.issuedAt + step.atMs;
    const nearbySamples = lightSamples.filter((s) => Math.abs(s.timestamp - targetTimestamp) <= LIGHT_CHALLENGE_WINDOW_MS);
    if (nearbySamples.length === 0) {
      reasons.push(`light_step_no_samples_near_${step.atMs}ms`);
      continue;
    }
    const closest = nearbySamples.reduce((best, sample) =>
      Math.abs(sample.timestamp - targetTimestamp) < Math.abs(best.timestamp - targetTimestamp) ? sample : best,
    );
    if (colorSimilarity(step.color, closest.perceivedColor) < LIGHT_CHALLENGE_MIN_COLOR_SIMILARITY) {
      reasons.push(`light_step_color_mismatch_at_${step.atMs}ms`);
    } else {
      matchedPerceivedColors.push(closest.perceivedColor);
    }
  }

  if (matchedPerceivedColors.length >= 2) {
    const emittedVaries = lightSequence.some((step) => colorSimilarity(step.color, lightSequence[0].color) < LIGHT_CHALLENGE_STATIC_SIMILARITY_THRESHOLD);
    const perceivedAllStatic = matchedPerceivedColors.every(
      (color) => colorSimilarity(color, matchedPerceivedColors[0]) > LIGHT_CHALLENGE_STATIC_SIMILARITY_THRESHOLD,
    );
    if (emittedVaries && perceivedAllStatic) {
      reasons.push("light_challenge_perceived_color_static");
    }
  }

  return { passed: reasons.length === 0, reasons };
}

export function verifyLivenessResponse(
  challenge: LivenessChallenge,
  response: LivenessResponsePayload,
  options: VerifyLivenessOptions = {},
): LivenessVerificationResult {
  const { samples, lightSamples } = response;
  const now = options.now ?? Date.now();
  const skew = options.maxTimestampSkewMs ?? DEFAULT_MAX_TIMESTAMP_SKEW_MS;
  const reasons: string[] = [];

  if (now > challenge.expiresAt) {
    reasons.push("challenge_expired");
  }

  if (samples.length === 0) {
    return {
      passed: false,
      steps: challenge.steps.map((s) => ({ action: s.action, satisfied: false, reason: "no_samples" })),
      frameChainIntact: false,
      reasons: [...reasons, "no_samples"],
    };
  }

  for (let i = 1; i < samples.length; i++) {
    if (samples[i].timestamp < samples[i - 1].timestamp) {
      reasons.push("samples_not_chronological");
      break;
    }
  }

  if (samples[0].timestamp < challenge.issuedAt - skew) {
    reasons.push("samples_start_before_challenge");
  }
  // Une réponse ne peut pas contenir d'images postérieures à sa vérification (horodatages inventés
  // à l'avance, soumission avant la fin réelle du défi).
  if (samples[samples.length - 1].timestamp > now + skew) {
    reasons.push("samples_after_verification");
  }

  const frameChain = verifyFrameChain(challenge, samples);
  if (!frameChain.intact) {
    reasons.push(...frameChain.reasons.map((r) => `frame_chain:${r}`));
  }

  const outcomes = challenge.steps.map((step) => verifyStep(step, samples, challenge.issuedAt));

  const riseDurations = outcomes.map((o) => o.riseDurationMs).filter((d): d is number => d !== undefined);
  if (riseDurations.length >= MIN_STEPS_FOR_UNIFORM_TIMING_CHECK) {
    const uniform = riseDurations.every((d) => Math.abs(d - riseDurations[0]) < UNIFORM_TIMING_TOLERANCE_MS);
    if (uniform) {
      reasons.push("suspiciously_uniform_timing");
    }
  }

  const steps: LivenessStepVerification[] = outcomes.map((outcome, index) => ({
    action: challenge.steps[index].action,
    satisfied: outcome.satisfied,
    reason: outcome.reason,
    riseDurationMs: outcome.riseDurationMs,
  }));

  let lightChallengePassed: boolean | undefined;
  if (challenge.lightSequence && challenge.lightSequence.length > 0) {
    const lightResult = verifyLightChallenge(challenge, lightSamples ?? []);
    lightChallengePassed = lightResult.passed;
    if (!lightResult.passed) {
      reasons.push(...lightResult.reasons.map((r) => `light_challenge:${r}`));
    }
  }

  const allStepsSatisfied = steps.every((s) => s.satisfied);
  const passed = allStepsSatisfied && frameChain.intact && (lightChallengePassed ?? true) && reasons.length === 0;

  return { passed, steps, frameChainIntact: frameChain.intact, lightChallengePassed, reasons };
}
