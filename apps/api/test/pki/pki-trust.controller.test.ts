import { describe, it, expect, vi } from "vitest";
import { HttpException } from "@nestjs/common";
import { PkiTrustController } from "../../src/modules/pki/pki-trust.controller";
import type { CscaBundleService } from "../../src/modules/pki/csca-bundle.service";
import type { CscaBundleSignerService } from "../../src/modules/pki/csca-bundle-signer.service";

describe("PkiTrustController", () => {
  describe("getCscaBundle", () => {
    it("renvoie le bundle construit par CscaBundleService", async () => {
      const bundle = { bundleFormatVersion: 1 as const, batchId: "batch-1", generatedAt: "2026-01-01T00:00:00.000Z", anchors: [], algorithm: "ECDSA-P256-SHA256" as const, signature: "sig" };
      const cscaBundle = { buildBundle: vi.fn().mockResolvedValue(bundle) } as unknown as CscaBundleService;
      const bundleSigner = { getPublicKeyBase64: vi.fn() } as unknown as CscaBundleSignerService;
      const controller = new PkiTrustController(cscaBundle, bundleSigner);

      await expect(controller.getCscaBundle()).resolves.toBe(bundle);
    });

    it("renvoie 503 quand aucune synchronisation n'a encore réussi, plutôt qu'un bundle vide trompeur", async () => {
      const cscaBundle = { buildBundle: vi.fn().mockResolvedValue(undefined) } as unknown as CscaBundleService;
      const bundleSigner = { getPublicKeyBase64: vi.fn() } as unknown as CscaBundleSignerService;
      const controller = new PkiTrustController(cscaBundle, bundleSigner);

      await expect(controller.getCscaBundle()).rejects.toBeInstanceOf(HttpException);
      await expect(controller.getCscaBundle()).rejects.toMatchObject({ status: 503 });
    });
  });

  describe("getSigningKey", () => {
    it("expose la clé publique configurée", () => {
      const cscaBundle = {} as CscaBundleService;
      const bundleSigner = { getPublicKeyBase64: vi.fn().mockReturnValue("pubkey==") } as unknown as CscaBundleSignerService;
      const controller = new PkiTrustController(cscaBundle, bundleSigner);

      expect(controller.getSigningKey()).toEqual({ algorithm: "ECDSA-P256-SHA256", publicKeySpkiBase64: "pubkey==" });
    });

    it("expose null quand aucune clé n'est configurée", () => {
      const cscaBundle = {} as CscaBundleService;
      const bundleSigner = { getPublicKeyBase64: vi.fn().mockReturnValue(undefined) } as unknown as CscaBundleSignerService;
      const controller = new PkiTrustController(cscaBundle, bundleSigner);

      expect(controller.getSigningKey()).toEqual({ algorithm: "ECDSA-P256-SHA256", publicKeySpkiBase64: null });
    });
  });
});
