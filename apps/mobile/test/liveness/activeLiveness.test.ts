import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { generateLivenessChallenge, verifyLivenessResponse, type LivenessActionType, type LivenessChallenge } from "@emrtd-verify/emrtd-core";
import {
  ActiveLivenessRecorder,
  challengeEndsAt,
  challengePhaseAt,
  lightColorAt,
  serverClockOffset,
  type ArkitLivenessFrame,
} from "../../src/liveness/activeLiveness";

const SERVER_ISSUED_AT = 1_790_000_000_000;
/** Horloge du téléphone en retard de 7 s sur le serveur ; aller-retour de 240 ms. */
const PHONE_BEHIND_MS = 7000;
const SKIN = { r: 0.62, g: 0.45, b: 0.38 };

function issue(challenge: LivenessChallenge) {
  const sentAt = challenge.issuedAt - PHONE_BEHIND_MS - 120;
  return { challenge, signature: "sig", sentAt, receivedAt: sentAt + 240 };
}

function newChallenge(light = false): LivenessChallenge {
  return generateLivenessChallenge({
    now: SERVER_ISSUED_AT,
    stepCount: light ? 4 : 3,
    requireLightChallenge: light,
    leadInMs: 3000,
    randomBytes: (n) => new Uint8Array(randomBytes(n)),
  });
}

/** Personne réelle simulée : chaque action culmine au milieu de sa fenêtre, montée progressive. */
function simulatePerson(
  challenge: LivenessChallenge,
  options: { skip?: LivenessActionType; anchorSwitchAtMs?: number; reflectScreen?: boolean } = {},
): ArkitLivenessFrame[] {
  const frames: ArkitLivenessFrame[] = [];
  const end = challengeEndsAt(challenge) + 500;
  for (let server = challenge.issuedAt - 1000; server <= end; server += 33) {
    const t = server - challenge.issuedAt;
    const frame: ArkitLivenessFrame = {
      timestamp: server - PHONE_BEHIND_MS,
      tracked: true,
      anchorId: options.anchorSwitchAtMs !== undefined && t > options.anchorSwitchAtMs ? "B" : "A",
      eyeBlinkLeft: 0.04,
      eyeBlinkRight: 0.05,
      jawOpen: 0.02,
      mouthSmileLeft: 0.03,
      mouthSmileRight: 0.03,
      headYawDegrees: 1.5,
    };
    for (const step of challenge.steps) {
      if (step.action === options.skip) continue;
      const mid = (step.windowStartMs + step.windowEndMs) / 2;
      const activation = Math.max(0, 1 - Math.abs(t - mid) / 600); // montée/descente sur 600 ms
      if (activation === 0) continue;
      if (step.action === "blink") frame.eyeBlinkLeft = frame.eyeBlinkRight = 0.9 * activation;
      if (step.action === "open_mouth") frame.jawOpen = 0.8 * activation;
      if (step.action === "smile") frame.mouthSmileLeft = frame.mouthSmileRight = 0.85 * activation;
      if (step.action === "turn_head_left") frame.headYawDegrees = -35 * activation;
      if (step.action === "turn_head_right") frame.headYawDegrees = 35 * activation;
    }
    // Lumière de l'écran réfléchie par la peau, affichée 60 ms après son heure (latence d'affichage).
    const shown = lightColorAt(challenge, server - 60);
    const k = options.reflectScreen === false || !shown ? 0 : 0.25;
    frame.perceivedColor = { r: SKIN.r + k * (shown?.r ?? 0), g: SKIN.g + k * (shown?.g ?? 0), b: SKIN.b + k * (shown?.b ?? 0) };
    frames.push(frame);
  }
  return frames;
}

function run(challenge: LivenessChallenge, frames: ArkitLivenessFrame[]) {
  const recorder = new ActiveLivenessRecorder(issue(challenge));
  frames.forEach((f) => recorder.push(f));
  return recorder.finish(challengeEndsAt(challenge) + 1500);
}

describe("défi de vivacité active côté mobile", () => {
  it("estime l'écart d'horloge téléphone/serveur au milieu de l'aller-retour", () => {
    const challenge = newChallenge();
    expect(serverClockOffset(issue(challenge))).toBe(PHONE_BEHIND_MS);
  });

  it("une réponse réelle passe la vérification locale ET celle du serveur (mêmes règles)", () => {
    const challenge = newChallenge();
    const outcome = run(challenge, simulatePerson(challenge));
    expect(outcome.check.passed).toBe(true);
    expect(outcome.anchorId).toBe("A");
    expect(outcome.trackingInterrupted).toBe(false);

    // Ce que le serveur recevra (JSON) : horodatages entiers, première image après issuedAt, chaîne intacte.
    const sent = JSON.parse(JSON.stringify(outcome.submission)) as typeof outcome.submission;
    expect(sent.samples.every((s) => Number.isInteger(s.timestamp))).toBe(true);
    expect(sent.samples[0].timestamp).toBeGreaterThanOrEqual(challenge.issuedAt);
    const server = verifyLivenessResponse(sent.challenge, { samples: sent.samples, lightSamples: sent.lightSamples }, { now: challengeEndsAt(challenge) + 4000 });
    expect(server.passed).toBe(true);
  });

  it("une action non faite est détectée tout de suite (on peut recommencer)", () => {
    const challenge = newChallenge();
    const skipped = challenge.steps[1].action;
    const outcome = run(challenge, simulatePerson(challenge, { skip: skipped }));
    expect(outcome.check.passed).toBe(false);
    expect(outcome.check.steps.find((s) => s.action === skipped)?.satisfied).toBe(false);
  });

  it("un suivi du visage interrompu (autre anchorId) est signalé", () => {
    const challenge = newChallenge();
    const outcome = run(challenge, simulatePerson(challenge, { anchorSwitchAtMs: 5000 }));
    expect(outcome.trackingInterrupted).toBe(true);
    expect(outcome.anchorId).toBeNull();
  });

  it("canal lumineux : le reflet des couleurs de l'écran est retrouvé malgré la couleur de peau", () => {
    const challenge = newChallenge(true);
    const outcome = run(challenge, simulatePerson(challenge));
    expect(outcome.submission.lightSamples?.length).toBe(challenge.lightSequence!.length);
    expect(outcome.check.lightChallengePassed).toBe(true);
    expect(outcome.check.passed).toBe(true);
  });

  it("canal lumineux : sans reflet (écran rejoué, vidéo), le défi échoue", () => {
    const challenge = newChallenge(true);
    const outcome = run(challenge, simulatePerson(challenge, { reflectScreen: false }));
    expect(outcome.check.lightChallengePassed).toBe(false);
    expect(outcome.check.passed).toBe(false);
  });

  it("consignes : préparation, action, retour de face, fin", () => {
    const challenge = newChallenge();
    const at = (ms: number) => challengePhaseAt(challenge, challenge.issuedAt + ms);
    expect(at(1000)).toMatchObject({ kind: "lead", next: challenge.steps[0].action });
    expect(at(challenge.steps[0].windowStartMs + 10)).toMatchObject({ kind: "step", index: 0 });
    expect(at(challenge.steps[0].windowEndMs + 100)).toMatchObject({ kind: "gap", nextIndex: 1 });
    expect(at(challenge.steps[2].windowEndMs + 100)).toEqual({ kind: "done" });
  });
});
