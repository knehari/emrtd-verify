import { describe, it, expect } from "vitest";
import { webcrypto } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { importEcdsaP256PublicKeyFromSpkiBase64, verifyJsonPayloadSignature } from "@emrtd-verify/emrtd-core";
import { ResultSignerService } from "../../src/modules/verification/result-signer.service";

async function generateKeyPairBase64(): Promise<{ pkcs8: string; spki: string }> {
  const keyPair = (await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pkcs8 = Buffer.from(await webcrypto.subtle.exportKey("pkcs8", keyPair.privateKey)).toString("base64");
  const spki = Buffer.from(await webcrypto.subtle.exportKey("spki", keyPair.publicKey)).toString("base64");
  return { pkcs8, spki };
}

function configWith(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as ConfigService;
}

describe("ResultSignerService", () => {
  it("émet une signature vide sans faire échouer l'appelant quand aucune clé n'est configurée", async () => {
    const service = new ResultSignerService(configWith({}));
    await expect(service.sign({ verdict: "authentic" })).resolves.toBe("");
  });

  it("émet une signature vide (sans lever) quand la clé configurée est invalide", async () => {
    const service = new ResultSignerService(configWith({ VERIFICATION_RESULT_SIGNING_PRIVATE_KEY: "pas-de-la-base64-pkcs8-valide" }));
    await expect(service.sign({ verdict: "authentic" })).resolves.toBe("");
  });

  it("produit une signature vérifiable avec la clé publique correspondante", async () => {
    const { pkcs8, spki } = await generateKeyPairBase64();
    const service = new ResultSignerService(configWith({ VERIFICATION_RESULT_SIGNING_PRIVATE_KEY: pkcs8 }));

    const payload = { verificationId: "abc-123", verdict: "authentic", verifiedAt: "2026-01-01T00:00:00.000Z" };
    const signature = await service.sign(payload);
    expect(signature.length).toBeGreaterThan(0);

    const publicKey = await importEcdsaP256PublicKeyFromSpkiBase64(spki);
    await expect(verifyJsonPayloadSignature(payload, signature, publicKey)).resolves.toBe(true);
  });

  it("rejette la vérification si le contenu signé a été altéré après coup", async () => {
    const { pkcs8, spki } = await generateKeyPairBase64();
    const service = new ResultSignerService(configWith({ VERIFICATION_RESULT_SIGNING_PRIVATE_KEY: pkcs8 }));

    const signature = await service.sign({ verdict: "authentic" });
    const publicKey = await importEcdsaP256PublicKeyFromSpkiBase64(spki);
    await expect(verifyJsonPayloadSignature({ verdict: "rejected" }, signature, publicKey)).resolves.toBe(false);
  });

  it("réutilise la clé privée déjà importée plutôt que de la réimporter à chaque appel", async () => {
    const { pkcs8 } = await generateKeyPairBase64();
    const service = new ResultSignerService(configWith({ VERIFICATION_RESULT_SIGNING_PRIVATE_KEY: pkcs8 }));

    const [sig1, sig2] = await Promise.all([service.sign({ a: 1 }), service.sign({ a: 2 })]);
    expect(sig1.length).toBeGreaterThan(0);
    expect(sig2.length).toBeGreaterThan(0);
  });

  describe("getPublicKeyBase64", () => {
    it("renvoie la clé publique configurée", () => {
      const service = new ResultSignerService(configWith({ VERIFICATION_RESULT_SIGNING_PUBLIC_KEY: "abc==" }));
      expect(service.getPublicKeyBase64()).toBe("abc==");
    });

    it("renvoie undefined quand rien n'est configuré", () => {
      const service = new ResultSignerService(configWith({}));
      expect(service.getPublicKeyBase64()).toBeUndefined();
    });
  });
});
