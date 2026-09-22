import { describe, it, expect } from "vitest";
import { generateLivenessChallenge } from "../src/liveness/challenge";
import {
  LIVENESS_ACTIVATION_THRESHOLD,
  LIVENESS_MIN_RISE_DURATION_MS,
  verifyLightChallenge,
  verifyLivenessResponse,
} from "../src/liveness/verify";
import type { LightSignalSample } from "../src/liveness/types";
import { chainFrames } from "../src/liveness/frameIntegrity";
import type { LivenessActionType, LivenessChallenge, LivenessSignalFrame } from "../src/liveness/types";

type RawFrame = Omit<LivenessSignalFrame, "frameIndex" | "frameHash">;

function neutralFrame(timestamp: number): RawFrame {
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

function activatedFrame(timestamp: number, action: LivenessActionType, intensity = 0.9): RawFrame {
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
function buildCompliantRawSamples(challenge: LivenessChallenge): RawFrame[] {
  const samples: RawFrame[] = [];
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
    const samples = chainFrames(challenge, buildCompliantRawSamples(challenge));
    const result = verifyLivenessResponse(challenge, { samples }, { now: challenge.issuedAt + 9000 });
    expect(result.passed).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.frameChainIntact).toBe(true);
    expect(result.steps.every((s) => s.satisfied)).toBe(true);
  });

  it("rejette si une action n'a jamais été détectée (aucun signal correspondant)", () => {
    const challenge = buildChallenge(1_000_000);
    const rawSamples = buildCompliantRawSamples(challenge).filter(
      (s) => s.timestamp < challenge.issuedAt + 3000, // supprime toute la 2e et 3e fenêtre
    );
    const samples = chainFrames(challenge, rawSamples);
    const result = verifyLivenessResponse(challenge, { samples }, { now: challenge.issuedAt + 9000 });
    expect(result.passed).toBe(false);
    expect(result.steps[1].satisfied).toBe(false);
    expect(result.steps[1].reason).toBe("open_mouth_no_samples_in_window");
  });

  it("rejette si l'action se produit hors de sa fenêtre assignée (ex. avant le début du challenge)", () => {
    const challenge = buildChallenge(1_000_000);
    // Le clignement (action de l'étape 1) se produit AVANT la fenêtre de l'étape 1 au lieu de dedans.
    const rawSamples: RawFrame[] = [
      neutralFrame(challenge.issuedAt - 2000),
      activatedFrame(challenge.issuedAt - 1000, "blink"),
      neutralFrame(challenge.issuedAt),
      neutralFrame(challenge.issuedAt + 500),
      neutralFrame(challenge.issuedAt + 2000),
      ...buildCompliantRawSamples(challenge).filter((s) => s.timestamp >= challenge.issuedAt + 3000),
    ];
    const samples = chainFrames(challenge, rawSamples);
    const result = verifyLivenessResponse(challenge, { samples }, { now: challenge.issuedAt + 9000 });
    expect(result.passed).toBe(false);
    expect(result.steps[0].satisfied).toBe(false);
  });

  it("rejette une montée instantanée (0 -> activé en un seul échantillon, délai < LIVENESS_MIN_RISE_DURATION_MS) — suspecte une injection directe plutôt qu'un mouvement capturé", () => {
    const challenge = buildChallenge(1_000_000);
    const windowStart = challenge.issuedAt + challenge.steps[0].windowStartMs;
    const rawSamples: RawFrame[] = [
      neutralFrame(windowStart),
      activatedFrame(windowStart + 1, "blink"), // 1ms de montée, bien en dessous du seuil minimal
      ...buildCompliantRawSamples(challenge).filter((s) => s.timestamp >= challenge.issuedAt + 3000),
    ];
    const samples = chainFrames(challenge, rawSamples);
    const result = verifyLivenessResponse(challenge, { samples }, { now: challenge.issuedAt + 9000 });
    expect(result.passed).toBe(false);
    expect(result.steps[0].reason).toBe("blink_rise_too_fast_suspect_injection");
    expect(result.steps[0].riseDurationMs).toBeLessThan(LIVENESS_MIN_RISE_DURATION_MS);
  });

  it("rejette un challenge expiré même si toutes les actions sont par ailleurs conformes", () => {
    const challenge = buildChallenge(1_000_000);
    const samples = chainFrames(challenge, buildCompliantRawSamples(challenge));
    const result = verifyLivenessResponse(challenge, { samples }, { now: challenge.expiresAt + 1 });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("challenge_expired");
  });

  it("rejette des échantillons vides", () => {
    const challenge = buildChallenge(1_000_000);
    const result = verifyLivenessResponse(challenge, { samples: [] }, { now: challenge.issuedAt + 1000 });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("no_samples");
  });

  it("rejette des horodatages non chronologiques (signal probable de trame rejouée/réordonnée) — casse aussi la chaîne de frames", () => {
    const challenge = buildChallenge(1_000_000);
    const samples = chainFrames(challenge, buildCompliantRawSamples(challenge));
    // Inverse les deux premiers échantillons APRÈS chaînage — scénario réel d'un attaquant qui
    // réordonne une réponse déjà capturée.
    [samples[0], samples[1]] = [samples[1], samples[0]];
    const result = verifyLivenessResponse(challenge, { samples }, { now: challenge.issuedAt + 9000 });
    expect(result.reasons).toContain("samples_not_chronological");
    expect(result.frameChainIntact).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("rejette un minutage suspicieusement uniforme entre les étapes (délai de montée identique au ms près sur >=3 étapes)", () => {
    const challenge = buildChallenge(1_000_000);
    const rawSamples: RawFrame[] = [];
    for (const step of challenge.steps) {
      const windowStart = challenge.issuedAt + step.windowStartMs;
      rawSamples.push(neutralFrame(windowStart));
      // Exactement le même délai de montée (200ms) pour les 3 actions — mécaniquement parfait.
      rawSamples.push(activatedFrame(windowStart + 200, step.action));
    }
    const samples = chainFrames(challenge, rawSamples);
    const result = verifyLivenessResponse(challenge, { samples }, { now: challenge.issuedAt + 9000 });
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("suspiciously_uniform_timing");
  });

  it("round-trip avec generateLivenessChallenge (aléa réel) : une réponse conforme construite à partir du challenge généré est acceptée", () => {
    const challenge = generateLivenessChallenge({ now: 2_000_000 });
    const samples = chainFrames(challenge, buildCompliantRawSamplesForGeneric(challenge));
    const result = verifyLivenessResponse(challenge, { samples }, {
      now: challenge.issuedAt + challenge.steps[challenge.steps.length - 1].windowEndMs + 100,
    });
    expect(result.passed).toBe(true);
  });
});

function buildCompliantRawSamplesForGeneric(challenge: LivenessChallenge): RawFrame[] {
  const samples: RawFrame[] = [];
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

function buildLightChallenge(issuedAt: number): LivenessChallenge {
  return {
    nonce: "light-test-nonce",
    issuedAt,
    expiresAt: issuedAt + 10_000,
    steps: [],
    lightSequence: [
      { atMs: 0, color: { r: 0.85, g: 0.05, b: 0.05 } }, // rouge
      { atMs: 1500, color: { r: 0.05, g: 0.85, b: 0.05 } }, // vert
      { atMs: 3000, color: { r: 0.05, g: 0.05, b: 0.85 } }, // bleu
    ],
  };
}

describe("verifyLightChallenge", () => {
  it("passe trivialement si le challenge n'a pas de lightSequence", () => {
    const challenge: LivenessChallenge = { nonce: "n", issuedAt: 0, expiresAt: 1000, steps: [] };
    expect(verifyLightChallenge(challenge, []).passed).toBe(true);
  });

  it("accepte une réponse où la couleur perçue correspond à chaque étape émise", () => {
    const challenge = buildLightChallenge(1_000_000);
    const lightSamples: LightSignalSample[] = challenge.lightSequence!.map((step) => ({
      timestamp: challenge.issuedAt + step.atMs,
      perceivedColor: { ...step.color },
    }));
    const result = verifyLightChallenge(challenge, lightSamples);
    expect(result.passed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("rejette l'absence totale d'échantillons alors qu'un lightSequence était requis", () => {
    const challenge = buildLightChallenge(1_000_000);
    const result = verifyLightChallenge(challenge, []);
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("light_challenge_no_samples");
  });

  it("rejette une couleur perçue trop éloignée de la couleur émise (ex. écran/vidéo qui ne réagit pas à la bonne couleur)", () => {
    const challenge = buildLightChallenge(1_000_000);
    const lightSamples: LightSignalSample[] = [
      { timestamp: challenge.issuedAt, perceivedColor: { r: 0.05, g: 0.05, b: 0.85 } }, // bleu au lieu de rouge
      { timestamp: challenge.issuedAt + 1500, perceivedColor: { r: 0.05, g: 0.85, b: 0.05 } },
      { timestamp: challenge.issuedAt + 3000, perceivedColor: { r: 0.05, g: 0.05, b: 0.85 } },
    ];
    const result = verifyLightChallenge(challenge, lightSamples);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.startsWith("light_step_color_mismatch"))).toBe(true);
  });

  it("rejette une couleur perçue figée (mais suffisamment proche des deux couleurs émises pour ne pas être rejetée par le seul critère de correspondance) alors que la séquence émise varie significativement — capteur non réactif/valeur copiée", () => {
    const issuedAt = 1_000_000;
    // Rouge et magenta partagent un canal rouge fort : une couleur perçue "moyenne" entre les deux
    // peut individuellement dépasser le seuil de similarité pour chacune, tout en étant strictement
    // identique d'une étape à l'autre — exactement le signal que ce contrôle doit détecter.
    const challenge: LivenessChallenge = {
      nonce: "light-static-nonce",
      issuedAt,
      expiresAt: issuedAt + 10_000,
      steps: [],
      lightSequence: [
        { atMs: 0, color: { r: 0.85, g: 0.05, b: 0.05 } }, // rouge
        { atMs: 1500, color: { r: 0.85, g: 0.05, b: 0.85 } }, // magenta
      ],
    };
    const staticPerceivedColor = { r: 0.85, g: 0.05, b: 0.45 };
    const lightSamples: LightSignalSample[] = challenge.lightSequence!.map((step) => ({
      timestamp: challenge.issuedAt + step.atMs,
      perceivedColor: { ...staticPerceivedColor },
    }));
    const result = verifyLightChallenge(challenge, lightSamples);
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("light_challenge_perceived_color_static");
  });
});
