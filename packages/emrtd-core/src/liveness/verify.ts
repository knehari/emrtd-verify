import type {
  LivenessActionType,
  LivenessChallenge,
  LivenessChallengeStep,
  LivenessSignalFrame,
  LivenessStepVerification,
  LivenessVerificationResult,
} from "./types";

/**
 * Vérification du protocole de challenge-réponse de liveness active (voir challenge.ts). Pure,
 * sans dépendance réseau/plateforme — testable avec des séries temporelles synthétiques, même
 * approche que packages/emrtd-core/src/nfc/bac.ts (simulation de puce indépendante). Ce module ne
 * fait AUCUNE hypothèse sur la source des échantillons (ARKit ou autre) : il opère uniquement sur
 * `LivenessSignalFrame`, la frontière de capture étant définie dans session.ts.
 *
 * Périmètre honnête (voir docs/facial-recognition.md) : ce protocole détecte qu'une action précise
 * a été exécutée dans une fenêtre temporelle imprévisible à l'avance, avec une dynamique de montée
 * plausible (ni instantanée, ni parfaitement identique d'une action à l'autre). Combiné à une
 * source de données 3D réelle (ARKit TrueDepth) côté capture, cela élimine structurellement une
 * photo, une vidéo pré-enregistrée ou un deepfake pré-rendu rejoués face à la caméra. Cela ne
 * prétend PAS détecter un deepfake piloté en temps réel par un opérateur humain qui répondrait
 * spontanément au challenge (scénario distinct identifié par l'ENISA, qui nécessite des mesures
 * complémentaires — attestation matérielle certifiée, revue humaine).
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

export function verifyLivenessResponse(
  challenge: LivenessChallenge,
  samples: LivenessSignalFrame[],
  options: VerifyLivenessOptions = {},
): LivenessVerificationResult {
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

  const outcomes = challenge.steps.map((step) => verifyStep(step, samples, challenge.issuedAt));

  const riseDurations = outcomes
    .map((o) => o.riseDurationMs)
    .filter((d): d is number => d !== undefined);
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

  const allStepsSatisfied = steps.every((s) => s.satisfied);
  const passed = allStepsSatisfied && reasons.length === 0;

  return { passed, steps, reasons };
}
