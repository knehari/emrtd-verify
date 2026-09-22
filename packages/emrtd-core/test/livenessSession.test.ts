import { describe, it, expect } from "vitest";
import { generateLivenessChallenge } from "../src/liveness/challenge";
import { verifyLivenessResponse } from "../src/liveness/verify";
import { createMockFaceLivenessSession } from "../src/liveness/session";
import type { LightSignalSample, LivenessChallenge, LivenessSignalFrame } from "../src/liveness/types";

describe("createMockFaceLivenessSession", () => {
  it("ne produit aucun échantillon avant start()", async () => {
    const session = createMockFaceLivenessSession();
    const { samples, lightSamples } = await session.stop();
    expect(samples).toEqual([]);
    expect(lightSamples).toEqual([]);
  });

  it("émet des échantillons à onSample()/onLightSample() et les renvoie aussi depuis stop()", async () => {
    const session = createMockFaceLivenessSession();
    const challenge = generateLivenessChallenge({ now: 0, requireLightChallenge: true });
    const received: LivenessSignalFrame[] = [];
    const receivedLight: LightSignalSample[] = [];
    session.onSample((frame) => received.push(frame));
    session.onLightSample((sample) => receivedLight.push(sample));

    await session.start(challenge);
    const stopped = await session.stop();

    expect(stopped.samples.length).toBeGreaterThan(0);
    expect(stopped.lightSamples.length).toBeGreaterThan(0);
    expect(received).toEqual(stopped.samples);
    expect(receivedLight).toEqual(stopped.lightSamples);
  });

  it("couvre toute la durée du challenge avec des échantillons chronologiques et un frameIndex séquentiel", async () => {
    const session = createMockFaceLivenessSession();
    const challenge = generateLivenessChallenge({ now: 1_000_000, stepCount: 3 });
    await session.start(challenge);
    const { samples } = await session.stop();

    const lastWindowEnd = challenge.issuedAt + challenge.steps[challenge.steps.length - 1].windowEndMs;
    expect(samples[0].timestamp).toBeGreaterThanOrEqual(challenge.issuedAt);
    expect(samples[samples.length - 1].timestamp).toBeLessThanOrEqual(lastWindowEnd);
    for (let i = 0; i < samples.length; i++) {
      expect(samples[i].frameIndex).toBe(i);
      if (i > 0) {
        expect(samples[i].timestamp).toBeGreaterThanOrEqual(samples[i - 1].timestamp);
      }
    }
  });

  it("la réponse synthétique par défaut satisfait verifyLivenessResponse (démontre le protocole de bout en bout sans matériel)", async () => {
    const session = createMockFaceLivenessSession();
    const challenge = generateLivenessChallenge({ now: 2_000_000, stepCount: 3 });
    await session.start(challenge);
    const { samples } = await session.stop();

    const result = verifyLivenessResponse(challenge, { samples }, {
      now: challenge.issuedAt + challenge.steps[challenge.steps.length - 1].windowEndMs + 100,
    });
    expect(result.passed).toBe(true);
  });

  it("la réponse synthétique par défaut satisfait aussi le canal challenge lumineux quand il est demandé", async () => {
    const session = createMockFaceLivenessSession();
    const challenge = generateLivenessChallenge({ now: 2_500_000, stepCount: 3, requireLightChallenge: true });
    await session.start(challenge);
    const { samples, lightSamples } = await session.stop();

    const result = verifyLivenessResponse(challenge, { samples, lightSamples }, {
      now: challenge.issuedAt + challenge.steps[challenge.steps.length - 1].windowEndMs + 100,
    });
    expect(result.lightChallengePassed).toBe(true);
    expect(result.passed).toBe(true);
  });

  it("accepte un générateur synthetize() personnalisé pour simuler une réponse non conforme (ex. action jamais exécutée)", async () => {
    const session = createMockFaceLivenessSession({
      synthesize: (challenge: LivenessChallenge) => [{ timestamp: challenge.issuedAt, eyeBlinkLeft: 0.02, eyeBlinkRight: 0.02, jawOpen: 0.02, mouthSmileLeft: 0.02, mouthSmileRight: 0.02, headYawDegrees: 0 }],
    });
    const challenge = generateLivenessChallenge({ now: 3_000_000, stepCount: 3 });
    await session.start(challenge);
    const { samples } = await session.stop();

    const result = verifyLivenessResponse(challenge, { samples }, {
      now: challenge.issuedAt + challenge.steps[challenge.steps.length - 1].windowEndMs + 100,
    });
    expect(result.passed).toBe(false);
  });
});
