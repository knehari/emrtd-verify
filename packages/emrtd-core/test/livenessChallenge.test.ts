import { describe, it, expect } from "vitest";
import { generateLivenessChallenge } from "../src/liveness/challenge";
import { LIVENESS_ACTION_TYPES } from "../src/liveness/types";

/** Source d'aléa déterministe pour des tests reproductibles — cycle à travers des octets fixes. */
function deterministicRandomBytes(seedBytes: number[]): (length: number) => Uint8Array {
  let cursor = 0;
  return (length: number) => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      out[i] = seedBytes[cursor % seedBytes.length];
      cursor++;
    }
    return out;
  };
}

describe("generateLivenessChallenge", () => {
  it("génère par défaut 3 actions distinctes", () => {
    const challenge = generateLivenessChallenge({ now: 1_000_000, randomBytes: deterministicRandomBytes([0, 2, 1]) });
    expect(challenge.steps).toHaveLength(3);
    const actions = challenge.steps.map((s) => s.action);
    expect(new Set(actions).size).toBe(3);
    for (const action of actions) {
      expect(LIVENESS_ACTION_TYPES).toContain(action);
    }
  });

  it("respecte stepCount et reste borné par le nombre d'actions disponibles", () => {
    const challenge = generateLivenessChallenge({ now: 0, stepCount: 100, randomBytes: deterministicRandomBytes([3]) });
    expect(challenge.steps).toHaveLength(LIVENESS_ACTION_TYPES.length);
  });

  it("produit des fenêtres séquentielles, non chevauchantes, avec un espacement entre chaque étape", () => {
    const challenge = generateLivenessChallenge({ now: 0, randomBytes: deterministicRandomBytes([1, 4, 0]) });
    for (let i = 0; i < challenge.steps.length; i++) {
      const step = challenge.steps[i];
      expect(step.windowEndMs).toBeGreaterThan(step.windowStartMs);
      if (i > 0) {
        const previous = challenge.steps[i - 1];
        expect(step.windowStartMs).toBeGreaterThan(previous.windowEndMs);
      }
    }
  });

  it("expiresAt est postérieur à la dernière fenêtre, avec une marge de soumission", () => {
    const challenge = generateLivenessChallenge({ now: 5000, randomBytes: deterministicRandomBytes([2, 0]) });
    const lastWindowEnd = challenge.issuedAt + challenge.steps[challenge.steps.length - 1].windowEndMs;
    expect(challenge.expiresAt).toBeGreaterThan(lastWindowEnd);
    expect(challenge.issuedAt).toBe(5000);
  });

  it("leadInMs décale toutes les fenêtres (réception + lecture de la consigne), pas la séquence lumineuse", () => {
    const base = generateLivenessChallenge({ now: 0, requireLightChallenge: true, randomBytes: deterministicRandomBytes([2, 0]) });
    const delayed = generateLivenessChallenge({ now: 0, requireLightChallenge: true, leadInMs: 3000, randomBytes: deterministicRandomBytes([2, 0]) });
    expect(delayed.steps[0].windowStartMs).toBe(3000);
    delayed.steps.forEach((step, i) => expect(step.windowStartMs - base.steps[i].windowStartMs).toBe(3000));
    expect(delayed.expiresAt - base.expiresAt).toBe(3000);
    expect(delayed.lightSequence![0].atMs).toBe(0);
    expect(delayed.lightSequence![delayed.lightSequence!.length - 1].atMs).toBeGreaterThan(delayed.steps[delayed.steps.length - 1].windowStartMs);
  });

  it("génère un nonce hexadécimal de 32 caractères (16 octets) — non trivial/vide", () => {
    const challenge = generateLivenessChallenge({ now: 0, randomBytes: deterministicRandomBytes([9, 8, 7, 6]) });
    expect(challenge.nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it("deux challenges générés avec des sources d'aléa différentes ont des nonces différents", () => {
    const a = generateLivenessChallenge({ now: 0, randomBytes: deterministicRandomBytes([1, 2, 3]) });
    const b = generateLivenessChallenge({ now: 0, randomBytes: deterministicRandomBytes([9, 8, 7]) });
    expect(a.nonce).not.toBe(b.nonce);
  });

  it("utilise crypto.getRandomValues par défaut (aléa réel, pas déterministe)", () => {
    const a = generateLivenessChallenge({ now: 0 });
    const b = generateLivenessChallenge({ now: 0 });
    expect(a.nonce).not.toBe(b.nonce);
  });

  it("n'inclut pas de lightSequence par défaut", () => {
    const challenge = generateLivenessChallenge({ now: 0, randomBytes: deterministicRandomBytes([1, 2, 3]) });
    expect(challenge.lightSequence).toBeUndefined();
  });

  it("requireLightChallenge produit une séquence de couleurs sans deux valeurs consécutives identiques", () => {
    const challenge = generateLivenessChallenge({
      now: 0,
      stepCount: 3,
      requireLightChallenge: true,
      randomBytes: deterministicRandomBytes([0, 1, 2, 0, 0, 1, 2]),
    });
    expect(challenge.lightSequence).toBeDefined();
    expect(challenge.lightSequence!.length).toBeGreaterThan(0);
    for (let i = 1; i < challenge.lightSequence!.length; i++) {
      const previous = challenge.lightSequence![i - 1].color;
      const current = challenge.lightSequence![i].color;
      expect(current).not.toEqual(previous);
    }
  });
});
