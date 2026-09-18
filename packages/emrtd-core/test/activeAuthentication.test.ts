import { describe, it, expect } from "vitest";
import { webcrypto } from "node:crypto";
import { Integer, Sequence } from "asn1js";
import { derEcdsaSignatureToRaw, verifyActiveAuthenticationResponse } from "../src/lds/activeAuthentication";
import { toArrayBuffer } from "../src/crypto/bytes";

const subtle = webcrypto.subtle;

/**
 * Simule ce qu'une vraie puce eMRTD renverrait : encode une signature ECDSA "raw" (r‖s,
 * format produit par SubtleCrypto.sign) vers le format DER (SEQUENCE { r INTEGER, s INTEGER })
 * attendu en pratique (convention ISO/IEC 7816-8). Inverse de `derEcdsaSignatureToRaw` —
 * réservé aux tests, jamais utilisé par le code de production (qui ne fait que décoder).
 */
function rawEcdsaSignatureToDer(raw: Uint8Array, componentLength: number): Uint8Array {
  const toUnsignedInteger = (bytes: Uint8Array): Integer => {
    const needsPadding = (bytes[0] & 0x80) !== 0;
    const value = needsPadding ? new Uint8Array([0, ...bytes]) : bytes;
    return new Integer({ valueHex: toArrayBuffer(value) });
  };
  const r = toUnsignedInteger(raw.slice(0, componentLength));
  const s = toUnsignedInteger(raw.slice(componentLength));
  return new Uint8Array(new Sequence({ value: [r, s] }).toBER(false));
}

async function generateDg15KeyPair(namedCurve: "P-256" | "P-384" = "P-256") {
  const keyPair = await subtle.generateKey({ name: "ECDSA", namedCurve }, true, ["sign", "verify"]);
  const publicKeyDer = new Uint8Array(await subtle.exportKey("spki", keyPair.publicKey));
  return { keyPair, publicKeyDer };
}

async function signChallenge(privateKey: CryptoKey, challenge: Uint8Array, hash: string, componentLength: number) {
  const rawSignature = new Uint8Array(
    await subtle.sign({ name: "ECDSA", hash }, privateKey, toArrayBuffer(challenge)),
  );
  return rawEcdsaSignatureToDer(rawSignature, componentLength);
}

describe("verifyActiveAuthenticationResponse", () => {
  it("valide une réponse authentique signée avec la clé privée correspondant à DG15 (P-256)", async () => {
    const { keyPair, publicKeyDer } = await generateDg15KeyPair("P-256");
    const challenge = webcrypto.getRandomValues(new Uint8Array(8));
    const responseDer = await signChallenge(keyPair.privateKey, challenge, "SHA-256", 32);

    const result = await verifyActiveAuthenticationResponse({ dg15PublicKeyDer: publicKeyDer, challenge, responseDer });

    expect(result.supported).toBe(true);
    expect(result.valid).toBe(true);
  });

  it("valide aussi une clé P-384 (composantes de signature plus longues)", async () => {
    const { keyPair, publicKeyDer } = await generateDg15KeyPair("P-384");
    const challenge = webcrypto.getRandomValues(new Uint8Array(8));
    const responseDer = await signChallenge(keyPair.privateKey, challenge, "SHA-384", 48);

    const result = await verifyActiveAuthenticationResponse({ dg15PublicKeyDer: publicKeyDer, challenge, responseDer });

    expect(result.supported).toBe(true);
    expect(result.valid).toBe(true);
  });

  it("rejette une réponse signée par une autre clé que celle de DG15 (usurpation)", async () => {
    const { publicKeyDer } = await generateDg15KeyPair("P-256");
    const attacker = await generateDg15KeyPair("P-256");
    const challenge = webcrypto.getRandomValues(new Uint8Array(8));
    const responseDer = await signChallenge(attacker.keyPair.privateKey, challenge, "SHA-256", 32);

    const result = await verifyActiveAuthenticationResponse({ dg15PublicKeyDer: publicKeyDer, challenge, responseDer });

    expect(result.supported).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("rejette un défi altéré après signature (protection contre le rejeu)", async () => {
    const { keyPair, publicKeyDer } = await generateDg15KeyPair("P-256");
    const challenge = webcrypto.getRandomValues(new Uint8Array(8));
    const responseDer = await signChallenge(keyPair.privateKey, challenge, "SHA-256", 32);

    const differentChallenge = webcrypto.getRandomValues(new Uint8Array(8));
    const result = await verifyActiveAuthenticationResponse({
      dg15PublicKeyDer: publicKeyDer,
      challenge: differentChallenge,
      responseDer,
    });

    expect(result.valid).toBe(false);
  });

  it("signale RSA comme non supporté plutôt que de tenter une vérification incorrecte", async () => {
    const rsaKeyPair = await subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const rsaPublicKeyDer = new Uint8Array(await subtle.exportKey("spki", rsaKeyPair.publicKey));

    const result = await verifyActiveAuthenticationResponse({
      dg15PublicKeyDer: rsaPublicKeyDer,
      challenge: new Uint8Array(8),
      responseDer: new Uint8Array(8),
    });

    expect(result.supported).toBe(false);
    expect(result.reason).toMatch(/RSA/);
  });
});

describe("derEcdsaSignatureToRaw / rawEcdsaSignatureToDer", () => {
  it("sont inverses l'une de l'autre", () => {
    const raw = webcrypto.getRandomValues(new Uint8Array(64));
    const der = rawEcdsaSignatureToDer(raw, 32);
    const roundTripped = derEcdsaSignatureToRaw(der, 32);
    expect(Array.from(roundTripped)).toEqual(Array.from(raw));
  });
});
