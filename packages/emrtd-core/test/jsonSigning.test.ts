import { describe, it, expect } from "vitest";
import { webcrypto } from "node:crypto";
import {
  canonicalJsonStringify,
  signJsonPayload,
  verifyJsonPayloadSignature,
  importEcdsaP256PrivateKeyFromPkcs8Base64,
  importEcdsaP256PublicKeyFromSpkiBase64,
} from "../src/crypto/jsonSigning";

describe("canonicalJsonStringify", () => {
  it("produit la même sortie quel que soit l'ordre d'insertion des clés", () => {
    const a = { b: 2, a: 1, c: { z: 1, y: 2 } };
    const b = { a: 1, c: { y: 2, z: 1 }, b: 2 };
    expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b));
  });

  it("préserve l'ordre des tableaux (seules les clés d'objet sont triées)", () => {
    expect(canonicalJsonStringify([3, 1, 2])).toBe("[3,1,2]");
  });
});

describe("signJsonPayload / verifyJsonPayloadSignature", () => {
  async function generateKeyPairBase64() {
    const keyPair = (await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const pkcs8 = Buffer.from(await webcrypto.subtle.exportKey("pkcs8", keyPair.privateKey)).toString("base64");
    const spki = Buffer.from(await webcrypto.subtle.exportKey("spki", keyPair.publicKey)).toString("base64");
    return { pkcs8, spki };
  }

  it("une signature valide vérifie avec succès, avec ou sans réordonnancement des clés", async () => {
    const { pkcs8, spki } = await generateKeyPairBase64();
    const privateKey = await importEcdsaP256PrivateKeyFromPkcs8Base64(pkcs8);
    const publicKey = await importEcdsaP256PublicKeyFromSpkiBase64(spki);

    const payload = { verificationId: "abc", verdict: "authentic", nested: { z: 1, a: 2 } };
    const signature = await signJsonPayload(payload, privateKey);

    const reorderedPayload = { nested: { a: 2, z: 1 }, verdict: "authentic", verificationId: "abc" };
    await expect(verifyJsonPayloadSignature(reorderedPayload, signature, publicKey)).resolves.toBe(true);
  });

  it("rejette une signature si le contenu a été altéré après signature", async () => {
    const { pkcs8, spki } = await generateKeyPairBase64();
    const privateKey = await importEcdsaP256PrivateKeyFromPkcs8Base64(pkcs8);
    const publicKey = await importEcdsaP256PublicKeyFromSpkiBase64(spki);

    const signature = await signJsonPayload({ verdict: "authentic" }, privateKey);
    await expect(verifyJsonPayloadSignature({ verdict: "rejected" }, signature, publicKey)).resolves.toBe(false);
  });

  it("rejette une signature vérifiée avec une clé publique différente", async () => {
    const { pkcs8 } = await generateKeyPairBase64();
    const { spki: otherSpki } = await generateKeyPairBase64();
    const privateKey = await importEcdsaP256PrivateKeyFromPkcs8Base64(pkcs8);
    const otherPublicKey = await importEcdsaP256PublicKeyFromSpkiBase64(otherSpki);

    const signature = await signJsonPayload({ verdict: "authentic" }, privateKey);
    await expect(verifyJsonPayloadSignature({ verdict: "authentic" }, signature, otherPublicKey)).resolves.toBe(false);
  });
});
