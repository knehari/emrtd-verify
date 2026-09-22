import { describe, it, expect } from "vitest";
import { chainFrames, computeFrameHash, genesisHash, verifyFrameChain } from "../src/liveness/frameIntegrity";
import type { LivenessChallenge, LivenessSignalFrame } from "../src/liveness/types";

type RawFrame = Omit<LivenessSignalFrame, "frameIndex" | "frameHash">;

function rawFrame(timestamp: number): RawFrame {
  return { timestamp, eyeBlinkLeft: 0.02, eyeBlinkRight: 0.02, jawOpen: 0.03, mouthSmileLeft: 0.02, mouthSmileRight: 0.02, headYawDegrees: 0 };
}

function buildChallenge(nonce: string): Pick<LivenessChallenge, "nonce"> {
  return { nonce };
}

describe("chainFrames / verifyFrameChain", () => {
  it("une chaîne construite par chainFrames est toujours vérifiée intacte", () => {
    const challenge = buildChallenge("nonce-a");
    const samples = chainFrames(challenge, [rawFrame(1000), rawFrame(1033), rawFrame(1066)]);
    const result = verifyFrameChain({ ...challenge, steps: [], issuedAt: 0, expiresAt: 0 }, samples);
    expect(result.intact).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("assigne un frameIndex séquentiel à partir de 0", () => {
    const challenge = buildChallenge("nonce-b");
    const samples = chainFrames(challenge, [rawFrame(0), rawFrame(33), rawFrame(66), rawFrame(99)]);
    expect(samples.map((s) => s.frameIndex)).toEqual([0, 1, 2, 3]);
  });

  it("détecte la substitution d'une frame après coup (contenu modifié sans recalculer les hachages en aval)", () => {
    const challenge = buildChallenge("nonce-c");
    const samples = chainFrames(challenge, [rawFrame(1000), rawFrame(1033), rawFrame(1066)]);
    // Un attaquant remplace le contenu de la frame du milieu SANS recalculer sa propre empreinte
    // ni celles qui suivent — c'est exactement le scénario que la chaîne doit détecter.
    const tampered = [...samples];
    tampered[1] = { ...tampered[1], jawOpen: 0.95 };
    const result = verifyFrameChain({ ...challenge, steps: [], issuedAt: 0, expiresAt: 0 }, tampered);
    expect(result.intact).toBe(false);
    expect(result.reasons[0]).toBe("frame_hash_chain_broken_at_index_1");
  });

  it("détecte une frame manquante (lacune dans frameIndex)", () => {
    const challenge = buildChallenge("nonce-d");
    const samples = chainFrames(challenge, [rawFrame(1000), rawFrame(1033), rawFrame(1066)]);
    const withGap = [samples[0], samples[2]]; // supprime l'index 1
    const result = verifyFrameChain({ ...challenge, steps: [], issuedAt: 0, expiresAt: 0 }, withGap);
    expect(result.intact).toBe(false);
    expect(result.reasons[0]).toBe("frame_index_out_of_sequence_at_position_1");
  });

  it("détecte une frame dupliquée", () => {
    const challenge = buildChallenge("nonce-e");
    const samples = chainFrames(challenge, [rawFrame(1000), rawFrame(1033)]);
    const withDuplicate = [samples[0], samples[0], samples[1]];
    const result = verifyFrameChain({ ...challenge, steps: [], issuedAt: 0, expiresAt: 0 }, withDuplicate);
    expect(result.intact).toBe(false);
  });

  it("une chaîne enregistrée pour un challenge donné échoue si vérifiée contre un AUTRE nonce (empêche le rejeu inter-challenges)", () => {
    const challengeA = buildChallenge("nonce-f");
    const challengeB = buildChallenge("nonce-g");
    const samples = chainFrames(challengeA, [rawFrame(1000), rawFrame(1033)]);
    const result = verifyFrameChain({ ...challengeB, steps: [], issuedAt: 0, expiresAt: 0 }, samples);
    expect(result.intact).toBe(false);
    expect(result.reasons[0]).toBe("frame_hash_chain_broken_at_index_0");
  });

  it("computeFrameHash est déterministe pour un contenu et un hash précédent identiques", () => {
    const frame = { frameIndex: 0, timestamp: 1000, eyeBlinkLeft: 0.1, eyeBlinkRight: 0.1, jawOpen: 0.1, mouthSmileLeft: 0.1, mouthSmileRight: 0.1, headYawDegrees: 0 };
    const previousHash = genesisHash("some-nonce");
    expect(computeFrameHash(frame, previousHash)).toBe(computeFrameHash(frame, previousHash));
  });

  it("genesisHash diffère pour des nonces différents", () => {
    expect(genesisHash("nonce-1")).not.toBe(genesisHash("nonce-2"));
  });

  it("une chaîne vide est intacte par vacuité", () => {
    const challenge = buildChallenge("nonce-h");
    const result = verifyFrameChain({ ...challenge, steps: [], issuedAt: 0, expiresAt: 0 }, []);
    expect(result.intact).toBe(true);
  });
});
