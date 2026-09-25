import { describe, it, expect, vi } from "vitest";
import { KycClientService } from "../../src/modules/kyc/kyc-client.service";

describe("KycClientService.hashApiKey", () => {
  it("est déterministe", () => {
    expect(KycClientService.hashApiKey("emrtd_abc")).toBe(KycClientService.hashApiKey("emrtd_abc"));
  });

  it("des clés différentes produisent des hachages différents", () => {
    expect(KycClientService.hashApiKey("emrtd_abc")).not.toBe(KycClientService.hashApiKey("emrtd_abd"));
  });

  it("produit un hachage hexadécimal SHA-256 (64 caractères)", () => {
    expect(KycClientService.hashApiKey("emrtd_abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("KycClientService.generateApiKey", () => {
  it("commence par le préfixe emrtd_", () => {
    expect(KycClientService.generateApiKey().startsWith("emrtd_")).toBe(true);
  });

  it("génère des clés distinctes à chaque appel (haute entropie)", () => {
    const keys = new Set(Array.from({ length: 20 }, () => KycClientService.generateApiKey()));
    expect(keys.size).toBe(20);
  });
});

describe("KycClientService.authenticate", () => {
  function buildService(prismaFindUnique: ReturnType<typeof vi.fn>) {
    const prisma = { kycClient: { findUnique: prismaFindUnique } } as never;
    return new KycClientService(prisma);
  }

  it("retourne null pour une clé qui ne porte pas le préfixe attendu (jamais de requête DB)", async () => {
    const findUnique = vi.fn();
    const service = buildService(findUnique);
    const result = await service.authenticate("not-a-valid-prefix");
    expect(result).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("retourne null quand aucun client ne correspond au hachage", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const service = buildService(findUnique);
    const result = await service.authenticate("emrtd_unknown");
    expect(result).toBeNull();
  });

  it("retourne null pour un client désactivé", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      clientId: "acme",
      acceptedTrustLevels: ["high"],
      allowedFields: [],
      active: false,
    });
    const service = buildService(findUnique);
    const result = await service.authenticate("emrtd_something");
    expect(result).toBeNull();
  });

  it("retourne le client authentifié quand le hachage correspond et qu'il est actif", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      clientId: "acme",
      acceptedTrustLevels: ["high", "medium"],
      allowedFields: ["dateOfBirth"],
      lostStolenCheckRequired: false,
      activeLivenessRequired: false,
      active: true,
    });
    const service = buildService(findUnique);
    const result = await service.authenticate("emrtd_something");
    expect(result).toEqual({
      clientId: "acme",
      acceptedTrustLevels: ["high", "medium"],
      allowedFields: ["dateOfBirth"],
      lostStolenCheckRequired: false,
      activeLivenessRequired: false,
    });
    expect(findUnique).toHaveBeenCalledWith({ where: { apiKeyHash: KycClientService.hashApiKey("emrtd_something") } });
  });
});
