import { describe, it, expect } from "vitest";
import { generateLivenessChallenge } from "../src/liveness/challenge";
import { verifyLivenessResponse } from "../src/liveness/verify";
import { createMockFaceLivenessSession } from "../src/liveness/session";
import type { LivenessChallenge, LivenessSignalFrame } from "../src/liveness/types";

describe("createMockFaceLivenessSession", () => {
  it("ne produit aucun échantillon avant start()", async () => {
    const session = createMockFaceLivenessSession();
    const samples = await session.stop();
    expect(samples).toEqual([]);
  });

  it("émet des échantillons à onSample() et les renvoie aussi depuis stop()", async () => {
    const session = createMockFaceLivenessSession();
    const challenge = generateLivenessChallenge({ now: 0 });
    const received: LivenessSignalFrame[] = [];
    session.onSample((frame) => received.push(frame));

    await session.start(challenge);
    const stopped = await session.stop();

    expect(stopped.length).toBeGreaterThan(0);
    expect(received).toEqual(stopped);
  });

  it("couvre toute la durée du challenge avec des échantillons chronologiques", async () => {
    const session = createMockFaceLivenessSession();
    const challenge = generateLivenessChallenge({ now: 1_000_000, stepCount: 3 });
    await session.start(challenge);
    const samples = await session.stop();

    const lastWindowEnd = challenge.issuedAt + challenge.steps[challenge.steps.length - 1].windowEndMs;
    expect(samples[0].timestamp).toBeGreaterThanOrEqual(challenge.issuedAt);
    expect(samples[samples.length - 1].timestamp).toBeLessThanOrEqual(lastWindowEnd);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].timestamp).toBeGreaterThanOrEqual(samples[i - 1].timestamp);
    }
  });

  it("la réponse synthétique par défaut satisfait verifyLivenessResponse (démontre le protocole de bout en bout sans matériel)", async () => {
    const session = createMockFaceLivenessSession();
    const challenge = generateLivenessChallenge({ now: 2_000_000, stepCount: 3 });
    await session.start(challenge);
    const samples = await session.stop();

    const result = verifyLivenessResponse(challenge, samples, {
      now: challenge.issuedAt + challenge.steps[challenge.steps.length - 1].windowEndMs + 100,
    });
    expect(result.passed).toBe(true);
  });

  it("accepte un générateur synthetize() personnalisé pour simuler une réponse non conforme (ex. action jamais exécutée)", async () => {
    const session = createMockFaceLivenessSession({
      synthesize: (challenge: LivenessChallenge) => [{ timestamp: challenge.issuedAt, eyeBlinkLeft: 0.02, eyeBlinkRight: 0.02, jawOpen: 0.02, mouthSmileLeft: 0.02, mouthSmileRight: 0.02, headYawDegrees: 0 }],
    });
    const challenge = generateLivenessChallenge({ now: 3_000_000, stepCount: 3 });
    await session.start(challenge);
    const samples = await session.stop();

    const result = verifyLivenessResponse(challenge, samples, {
      now: challenge.issuedAt + challenge.steps[challenge.steps.length - 1].windowEndMs + 100,
    });
    expect(result.passed).toBe(false);
  });
});
