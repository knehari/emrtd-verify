import { describe, it, expect } from "vitest";
import { webcrypto, createHash, randomBytes, generateKeyPairSync, privateEncrypt, constants, sign as nodeSign, type KeyObject } from "node:crypto";
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

  describe("RSA — ISO/IEC 9796-2 schéma 1, récupération partielle (signatures produites par OpenSSL)", () => {
    // F = 6A || M1 || H(M1 || défi) || trailer, puis s = F^d mod n (opération RSA privée brute d'OpenSSL).
    function signIso9796(privateKey: KeyObject, k: number, challenge: Uint8Array, hash: "sha1" | "sha256", header = 0x6a) {
      const hLen = hash === "sha1" ? 20 : 32;
      const trailer = hash === "sha1" ? [0xbc] : [0x34, 0xcc];
      const m1 = randomBytes(k - 1 - hLen - trailer.length);
      const digest = createHash(hash).update(Buffer.concat([m1, Buffer.from(challenge)])).digest();
      const f = Buffer.concat([Buffer.from([header]), m1, digest, Buffer.from(trailer)]);
      f[1] &= 0x7f; // F < n
      const fixedDigest = createHash(hash).update(Buffer.concat([f.subarray(1, 1 + m1.length), Buffer.from(challenge)])).digest();
      fixedDigest.copy(f, 1 + m1.length);
      return new Uint8Array(privateEncrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, f));
    }

    it.each(["sha1", "sha256"] as const)("valide une réponse authentique (%s) et rejette un défi ou une signature altérés", async (hash) => {
      const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
      const dg15PublicKeyDer = new Uint8Array(publicKey.export({ type: "spki", format: "der" }));
      const challenge = Uint8Array.from(randomBytes(8));
      const responseDer = signIso9796(privateKey, 128, challenge, hash);
      await expect(verifyActiveAuthenticationResponse({ dg15PublicKeyDer, challenge, responseDer })).resolves.toMatchObject({ supported: true, valid: true });
      const otherChallenge = Uint8Array.from(challenge);
      otherChallenge[0] ^= 1;
      await expect(verifyActiveAuthenticationResponse({ dg15PublicKeyDer, challenge: otherChallenge, responseDer })).resolves.toMatchObject({ valid: false });
      const tampered = Uint8Array.from(responseDer);
      tampered[40] ^= 1;
      await expect(verifyActiveAuthenticationResponse({ dg15PublicKeyDer, challenge, responseDer: tampered })).resolves.toMatchObject({ valid: false });
    });

    it("refuse la récupération totale (le défi ne serait pas signé)", async () => {
      const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
      const dg15PublicKeyDer = new Uint8Array(publicKey.export({ type: "spki", format: "der" }));
      const challenge = Uint8Array.from(randomBytes(8));
      const responseDer = signIso9796(privateKey, 128, challenge, "sha1", 0x4a);
      await expect(verifyActiveAuthenticationResponse({ dg15PublicKeyDer, challenge, responseDer })).resolves.toMatchObject({ valid: false });
    });
  });

  it("valide une signature ECDSA plain r||s (format BSI TR-03111 des puces) sur brainpoolP256r1", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "brainpoolP256r1" });
    const dg15PublicKeyDer = new Uint8Array(publicKey.export({ type: "spki", format: "der" }));
    const challenge = Uint8Array.from(randomBytes(8));
    const responseDer = new Uint8Array(nodeSign("sha256", challenge, { key: privateKey, dsaEncoding: "ieee-p1363" }));
    await expect(verifyActiveAuthenticationResponse({ dg15PublicKeyDer, challenge, responseDer })).resolves.toMatchObject({ valid: true });
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
