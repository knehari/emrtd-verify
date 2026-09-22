import { describe, it, expect } from "vitest";
import { webcrypto } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { importEcdsaP256PublicKeyFromSpkiBase64, verifyJsonPayloadSignature } from "@emrtd-verify/emrtd-core";
import { CscaBundleSignerService } from "../../src/modules/pki/csca-bundle-signer.service";

async function generateKeyPairBase64(): Promise<{ pkcs8: string; spki: string }> {
  const keyPair = (await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pkcs8 = Buffer.from(await webcrypto.subtle.exportKey("pkcs8", keyPair.privateKey)).toString("base64");
  const spki = Buffer.from(await webcrypto.subtle.exportKey("spki", keyPair.publicKey)).toString("base64");
  return { pkcs8, spki };
}

function configWith(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as ConfigService;
}

describe("CscaBundleSignerService", () => {
  it("émet une signature vide sans faire échouer l'appelant quand aucune clé n'est configurée", async () => {
    const service = new CscaBundleSignerService(configWith({}));
    await expect(service.sign({ bundleFormatVersion: 1, batchId: "batch-1", generatedAt: "2026-01-01T00:00:00.000Z", anchors: [], algorithm: "ECDSA-P256-SHA256" })).resolves.toBe("");
  });

  it("émet une signature vide (sans lever) quand la clé configurée est invalide", async () => {
    const service = new CscaBundleSignerService(configWith({ CSCA_BUNDLE_SIGNING_PRIVATE_KEY: "pas-de-la-base64-pkcs8-valide" }));
    await expect(service.sign({ bundleFormatVersion: 1, batchId: "batch-1", generatedAt: "2026-01-01T00:00:00.000Z", anchors: [], algorithm: "ECDSA-P256-SHA256" })).resolves.toBe("");
  });

  it("produit une signature vérifiable avec la clé publique correspondante", async () => {
    const { pkcs8, spki } = await generateKeyPairBase64();
    const service = new CscaBundleSignerService(configWith({ CSCA_BUNDLE_SIGNING_PRIVATE_KEY: pkcs8 }));

    const bundle = { bundleFormatVersion: 1 as const, batchId: "batch-1", generatedAt: "2026-01-01T00:00:00.000Z", anchors: [], algorithm: "ECDSA-P256-SHA256" as const };
    const signature = await service.sign(bundle);
    expect(signature.length).toBeGreaterThan(0);

    const publicKey = await importEcdsaP256PublicKeyFromSpkiBase64(spki);
    await expect(verifyJsonPayloadSignature(bundle, signature, publicKey)).resolves.toBe(true);
  });

  it("rejette la vérification si le bundle signé a été altéré après coup (ex. ancres substituées)", async () => {
    const { pkcs8, spki } = await generateKeyPairBase64();
    const service = new CscaBundleSignerService(configWith({ CSCA_BUNDLE_SIGNING_PRIVATE_KEY: pkcs8 }));

    const bundle = { bundleFormatVersion: 1 as const, batchId: "batch-1", generatedAt: "2026-01-01T00:00:00.000Z", anchors: [], algorithm: "ECDSA-P256-SHA256" as const };
    const signature = await service.sign(bundle);

    const tampered = { ...bundle, batchId: "batch-attacker-controlled" };
    const publicKey = await importEcdsaP256PublicKeyFromSpkiBase64(spki);
    await expect(verifyJsonPayloadSignature(tampered, signature, publicKey)).resolves.toBe(false);
  });

  describe("getPublicKeyBase64", () => {
    it("renvoie la clé publique configurée", () => {
      const service = new CscaBundleSignerService(configWith({ CSCA_BUNDLE_SIGNING_PUBLIC_KEY: "abc==" }));
      expect(service.getPublicKeyBase64()).toBe("abc==");
    });

    it("renvoie undefined quand rien n'est configuré", () => {
      const service = new CscaBundleSignerService(configWith({}));
      expect(service.getPublicKeyBase64()).toBeUndefined();
    });
  });
});
