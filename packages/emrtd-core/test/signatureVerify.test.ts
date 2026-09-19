import { describe, it, expect } from "vitest";
import { createPublicKey, generateKeyPairSync, sign as nodeSign, verify as nodeVerify, webcrypto } from "node:crypto";
import { verifyRawSignature, registerEcdsaFallbackVerifier } from "../src/crypto/signatureVerify";

const subtle = webcrypto.subtle;

// En production, ce repli est enregistré par packages/pki-trust/src/nodeCryptoFallback.ts (voir sa
// docstring : emrtd-core reste volontairement dépourvu de toute référence à node:crypto/Buffer
// pour rester compilable comme dépendance source par apps/mobile). Ce test vit dans emrtd-core et
// n'a pas cette contrainte de portabilité — il enregistre son propre repli, identique.
registerEcdsaFallbackVerifier(async ({ spkiDer, hash, signature, signedData }) => {
  const publicKey = createPublicKey({ key: Buffer.from(spkiDer), format: "der", type: "spki" });
  return nodeVerify(hash.toLowerCase().replace("-", ""), Buffer.from(signedData), publicKey, Buffer.from(signature));
});

describe("verifyRawSignature", () => {
  it("vérifie une signature ECDSA sur une courbe Brainpool via le repli node:crypto (Web Crypto ne la supporte pas nativement)", () => {
    // brainpoolP256r1 (RFC 5639) : constaté sur 12 des 28 Master List Signers réels d'un export
    // LDIF ICAO PKD (BSI TR-03110). Web Crypto rejette cette courbe ; node:crypto (OpenSSL) non.
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "brainpoolP256r1" });
    const spkiDer = new Uint8Array(publicKey.export({ format: "der", type: "spki" }));
    const message = new TextEncoder().encode("contenu signé de test");
    const signature = new Uint8Array(nodeSign("sha256", message, privateKey));

    return verifyRawSignature({
      spkiDer,
      signatureAlgorithmOid: "1.2.840.10045.4.3.2", // ecdsa-with-SHA256
      signature,
      signedData: message,
    }).then((result) => expect(result).toBe(true));
  });

  it("rejette une signature Brainpool altérée", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "brainpoolP384r1" });
    const spkiDer = new Uint8Array(publicKey.export({ format: "der", type: "spki" }));
    const message = new TextEncoder().encode("contenu original");
    const signature = new Uint8Array(nodeSign("sha384", message, privateKey));
    const tamperedMessage = new TextEncoder().encode("contenu altéré");

    const result = await verifyRawSignature({
      spkiDer,
      signatureAlgorithmOid: "1.2.840.10045.4.3.3", // ecdsa-with-SHA384
      signature,
      signedData: tamperedMessage,
    });
    expect(result).toBe(false);
  });

  it("vérifie toujours une signature RSA PKCS#1 v1.5 sur P-256/RSA via Web Crypto (chemin inchangé)", async () => {
    const keyPair = (await subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const spkiDer = new Uint8Array(await subtle.exportKey("spki", keyPair.publicKey));
    const message = new TextEncoder().encode("contenu RSA");
    const signature = new Uint8Array(await subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, keyPair.privateKey, message));

    const result = await verifyRawSignature({
      spkiDer,
      signatureAlgorithmOid: "1.2.840.113549.1.1.11", // sha256WithRSAEncryption
      signature,
      signedData: message,
    });
    expect(result).toBe(true);
  });

  it("vérifie une signature ECDSA P-256 (courbe supportée nativement par Web Crypto, chemin rapide inchangé)", async () => {
    const keyPair = (await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const spkiDer = new Uint8Array(await subtle.exportKey("spki", keyPair.publicKey));
    const message = new TextEncoder().encode("contenu P-256");
    const signature = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, message));

    const result = await verifyRawSignature({
      spkiDer,
      signatureAlgorithmOid: "1.2.840.10045.4.3.2", // ecdsa-with-SHA256
      signature,
      signedData: message,
    });
    expect(result).toBe(true);
  });
});
