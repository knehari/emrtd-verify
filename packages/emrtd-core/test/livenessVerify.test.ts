import { describe, it, expect } from "vitest";
import { generateLivenessChallenge } from "../src/liveness/challenge";
import {
  LIVENESS_ACTIVATION_THRESHOLD,
  LIVENESS_MIN_RISE_DURATION_MS,
  verifyLivenessResponse,
} from "../src/liveness/verify";
import type { LivenessActionType, LivenessChallenge, LivenessSignalFrame } from "../src/liveness/types";

function neutralFrame(timestamp: number): LivenessSignalFrame {
  return {
    timestamp,
    eyeBlinkLeft: 0.02,
    eyeBlinkRight: 0.02,
    jawOpen: 0.03,
    mouthSmileLeft: 0.02,
    mouthSmileRight: 0.02,
    headYawDegrees: 0,
  };
}

function activatedFrame(timestamp: number, action: LivenessActionType, intensity = 0.9): LivenessSignalFrame {
  const frame = neutralFrame(timestamp);
  switch (action) {
    case "blink":
      frame.eyeBlinkLeft = intensity;
      frame.eyeBlinkRight = intensity;
      break;
    case "open_mouth":
      frame.jawOpen = intensity;
      break;
    case "smile":
      frame.mouthSmileLeft = intensity;
      frame.mouthSmileRight = intensity;
      break;
    case "turn_head_left":
      frame.headYawDegrees = -30;
      break;
    case "turn_head_right":
      frame.headYawDegrees = 30;
      break;
  }
  return frame;
}

/** Construit un challenge à 3 étapes fixes (indépendant de generateLivenessChallenge) pour des tests entièrement déterministes. */
function buildChallenge(issuedAt: number): LivenessChallenge {
  return {
    nonce: "test-nonce",
    issuedAt,
    expiresAt: issuedAt + 12_000,
    steps: [
      { action: "blink", windowStartMs: 0, windowEndMs: 2500 },
      { action: "open_mouth", windowStartMs: 3000, windowEndMs: 5500 },
      { action: "turn_head_left", windowStartMs: 6000, windowEndMs: 8500 },
    ],
  };
}

/**
 * Réponse conforme : chaque action monte à mi-fenêtre avec un délai de montée réaliste, redescend
 * ensuite. Le délai de montée VARIE délibérément d'une étape à l'autre (comme une vraie capture
 * humaine) — un délai identique au ms près sur toutes les étapes est justement ce que
 * `suspiciously_uniform_timing` doit détecter (voir le test dédié plus bas), donc un fixture
 * "conforme" mécaniquement uniforme déclencherait à tort ce même signal.
 */
function buildCompliantSamples(challenge: LivenessChallenge): LivenessSignalFrame[] {
  const samples: LivenessSignalFrame[] = [];
  challenge.steps.forEach((step, index) => {
    const windowStart = challenge.issuedAt + step.windowStartMs;
    const riseOffsetMs = 400 + index * 137; // varie naturellement d'une étape à l'autre
    samples.push(neutralFrame(windowStart));
    samples.push(neutralFrame(windowStart + 200));
    samples.push(activatedFrame(windowStart + riseOffsetMs, step.action));
    samples.push(activatedFrame(windowStart + riseOffsetMs + 400, step.action));
    samples.push(neutralFrame(windowStart + 1500));
  });
  return samples;
}

describe("verifyLivenessResponse", () => {
  it("accepte une réponse conforme : chaque action détectée dans sa fenêtre avec un minutage réaliste", () => {
    const challenge = buildChallenge(1_000_000);
    const result = verifyLivenessResponse(challenge, buildCompliantSamples(challenge), { now: challenge.issuedAt + 9000 });
    expect(result.passed).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.steps.every((s) => s.satisfied)).toBe(true);
  });

  it("rejette si une action n'a jamais été détectée (aucun signal correspondant)", () => {
    const challenge = buildChallenge(1_000_000);
    const samples = buildCompliantSamples(challenge).filter(
      (s) => s.timestamp < challenge.issuedAt + 3000, // supprime toute la 2e et 3e fenêtre
    );
    const result = verifyLivenessResponse(challenge, samples, { now: challenge.issuedAt + 9000 });
    expect(result.passed).toBe(false);
    expect(result.steps[1].satisfied).toBe(false);
    expect(result.steps[1].reason).toBe("open_mouth_no_samples_in_window");
  });

  it("rejette si l'action se produit hors de sa fenêtre assignée (ex. avant le début du challenge)", () => {
    const challenge = buildChallenge(1_000_000);
    // Le clignement (action de l'étape 1) se produit AVANT la fenêtre de l'étape 1 au lieu de dedans.
    const samples = [
      neutralFrame(challenge.issuedAt - 2000),
      activatedFrame(challenge.issuedAt - 1000, "blink"),
      neutralFrame(challenge.issuedAt),
      neutralFrame(challenge.issuedAt + 500),
      neutralFrame(challenge.issuedAt + 2000),
      ...buildCompliantSamples(challenge).filter((s) => s.timestamp >= challenge.issuedAt + 3000),
    ];
    const result = verifyLivenessResponse(challenge, samples, { now: challenge.issuedAt + 9000 });
    expect(result.passed).toBe(false);
    expect(result.steps[0].satisfied).toBe(false);
  });

  it("rejette une montée instantanée (0 -> activé en un seul échantillon, délai < LIVENESS_MIN_RISE_DURATION_MS) — suspecte une injection directe plutôt qu'un mouvement capturé", () => {
    const challenge = buildChallenge(1_000_000);
    const windowStart = challenge.issuedAt + challenge.steps[0].windowStartMs;
    const samples: LivenessSignalFrame[] = [
      neutralFrame(windowStart),
      activatedFrame(windowStart + 1, "blink"), // 1ms de montée, bien en dessous du seuil minimal
      ...buildCompliantSamples(challenge).filter((s) => s.timestamp >= challenge.issuedAt + 3000),
    ];
    const result = verifyLivenessResponse(challenge, samples, { now: challenge.issuedAt + 9000 });
    expect(result.passed).toBe(false);
    expect(result.steps[0].reason).toBe("blink_rise_too_fast_suspect_injection");
    expect(result.steps[0].riseDurationMs).toBeLessThan(LIVENESS_MIN_RISE_DURATION_MS);
  });

  it("rejette un challenge expiré même si toutes les actions sont par ailleurs conformes", () => {
    const challenge = buildChallenge(1_000_000);
    const result = verifyLivenessResponse(challenge, buildCompliantSamples(challenge), { now: challenge.expiresAt + 1 });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("challenge_expired");
  });

  it("rejette des échantillons vides", () => {
    const challenge = buildChallenge(1_000_000);
    const result = verifyLivenessResponse(challenge, [], { now: challenge.issuedAt + 1000 });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("no_samples");
  });

  it("rejette des horodatages non chronologiques (signal probable de trame rejouée/réordonnée)", () => {
    const challenge = buildChallenge(1_000_000);
    const samples = buildCompliantSamples(challenge);
    // Inverse les deux premiers échantillons.
    [samples[0], samples[1]] = [samples[1], samples[0]];
    const result = verifyLivenessResponse(challenge, samples, { now: challenge.issuedAt + 9000 });
    expect(result.reasons).toContain("samples_not_chronological");
    expect(result.passed).toBe(false);
  });

  it("rejette un minutage suspicieusement uniforme entre les étapes (délai de montée identique au ms près sur >=3 étapes)", () => {
    const challenge = buildChallenge(1_000_000);
    const samples: LivenessSignalFrame[] = [];
    for (const step of challenge.steps) {
      const windowStart = challenge.issuedAt + step.windowStartMs;
      samples.push(neutralFrame(windowStart));
      // Exactement le même délai de montée (200ms) pour les 3 actions — mécaniquement parfait.
      samples.push(activatedFrame(windowStart + 200, step.action));
    }
    const result = verifyLivenessResponse(challenge, samples, { now: challenge.issuedAt + 9000 });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("suspiciously_uniform_timing");
  });

  it("round-trip avec generateLivenessChallenge (aléa réel) : une réponse conforme construite à partir du challenge généré est acceptée", () => {
    const challenge = generateLivenessChallenge({ now: 2_000_000 });
    const samples = buildCompliantSamplesForGeneric(challenge);
    const result = verifyLivenessResponse(challenge, samples, {
      now: challenge.issuedAt + challenge.steps[challenge.steps.length - 1].windowEndMs + 100,
    });
    expect(result.passed).toBe(true);
  });
});

function buildCompliantSamplesForGeneric(challenge: LivenessChallenge): LivenessSignalFrame[] {
  const samples: LivenessSignalFrame[] = [];
  challenge.steps.forEach((step, index) => {
    const windowStart = challenge.issuedAt + step.windowStartMs;
    const riseOffsetMs = 400 + index * 137;
    samples.push(neutralFrame(windowStart));
    samples.push(neutralFrame(windowStart + 200));
    samples.push(activatedFrame(windowStart + riseOffsetMs, step.action));
    samples.push(activatedFrame(windowStart + riseOffsetMs + 400, step.action));
  });
  return samples;
}

describe("LIVENESS_ACTIVATION_THRESHOLD", () => {
  it("est strictement entre 0 et 1 (invariant de configuration)", () => {
    expect(LIVENESS_ACTIVATION_THRESHOLD).toBeGreaterThan(0);
    expect(LIVENESS_ACTIVATION_THRESHOLD).toBeLessThan(1);
  });
});
