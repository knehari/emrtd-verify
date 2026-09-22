import { describe, it, expect, vi } from "vitest";
import { CscaBundleService } from "../../src/modules/pki/csca-bundle.service";
import type { CscaStoreService } from "../../src/modules/pki/csca-store.service";
import type { CscaBundleSignerService } from "../../src/modules/pki/csca-bundle-signer.service";

describe("CscaBundleService", () => {
  it("renvoie undefined quand aucun lot n'est actif (aucune synchronisation réussie)", async () => {
    const cscaStore = { getActiveBatchId: vi.fn().mockResolvedValue(undefined), getAllAnchors: vi.fn() } as unknown as CscaStoreService;
    const bundleSigner = { sign: vi.fn() } as unknown as CscaBundleSignerService;
    const service = new CscaBundleService(cscaStore, bundleSigner);

    await expect(service.buildBundle()).resolves.toBeUndefined();
    expect(bundleSigner.sign).not.toHaveBeenCalled();
  });

  it("encode certificateDer en base64 et inclut la signature retournée par le signeur", async () => {
    const certificateDer = new Uint8Array([0x30, 0x82, 0x01, 0x0a, 0xff]);
    const cscaStore = {
      getActiveBatchId: vi.fn().mockResolvedValue("batch-42"),
      getAllAnchors: vi.fn().mockResolvedValue([
        {
          countryCode: "FRA",
          certificateDer,
          subject: "CN=CSCA France",
          serialNumber: "01",
          notBefore: "2020-01-01T00:00:00.000Z",
          notAfter: "2030-01-01T00:00:00.000Z",
          source: "icao-pkd",
          level: "high",
        },
      ]),
    } as unknown as CscaStoreService;
    const bundleSigner = { sign: vi.fn().mockResolvedValue("signature-base64") } as unknown as CscaBundleSignerService;
    const service = new CscaBundleService(cscaStore, bundleSigner);

    const bundle = await service.buildBundle();

    expect(bundle).toBeDefined();
    expect(bundle!.batchId).toBe("batch-42");
    expect(bundle!.bundleFormatVersion).toBe(1);
    expect(bundle!.algorithm).toBe("ECDSA-P256-SHA256");
    expect(bundle!.signature).toBe("signature-base64");
    expect(bundle!.anchors).toHaveLength(1);
    expect(bundle!.anchors[0]!.certificateDerBase64).toBe(Buffer.from(certificateDer).toString("base64"));
    // round-trip : le mobile doit pouvoir reconstruire exactement les mêmes octets DER.
    expect(new Uint8Array(Buffer.from(bundle!.anchors[0]!.certificateDerBase64, "base64"))).toEqual(certificateDer);

    // Le signeur doit avoir reçu le bundle SANS le champ signature (voir CscaBundleSignerService).
    expect(bundleSigner.sign).toHaveBeenCalledWith(expect.not.objectContaining({ signature: expect.anything() }));
  });
});
