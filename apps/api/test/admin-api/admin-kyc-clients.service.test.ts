import { describe, it, expect, vi } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { AdminKycClientsService } from "../../src/modules/admin-api/admin-kyc-clients.service";

function buildService(existing: unknown) {
  const findUnique = vi.fn().mockResolvedValue(existing);
  const create = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "kc-1", createdAt: new Date(), ...data }));
  const update = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "kc-1", clientId: "acme-bank", createdAt: new Date(), ...data }));
  const findMany = vi.fn().mockResolvedValue([]);
  const prisma = { kycClient: { findUnique, create, update, findMany } } as never;
  return { service: new AdminKycClientsService(prisma), findUnique, create, update, findMany };
}

describe("AdminKycClientsService.create", () => {
  it("crée un tenant et renvoie la clé API en clair une seule fois", async () => {
    const { service, create } = buildService(null);
    const result = await service.create({ clientId: "acme-bank", acceptedTrustLevels: ["high"], allowedFields: ["documentNumber"] });

    expect(result.apiKey).toMatch(/^emrtd_/);
    expect(result).not.toHaveProperty("apiKeyHash");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ clientId: "acme-bank", apiKeyHash: expect.any(String) }) }),
    );
  });

  it("exige le registre perdus/volés par défaut, et accepte « non exigé » explicitement", async () => {
    const { service, create } = buildService(null);
    const byDefault = await service.create({ clientId: "acme-bank", acceptedTrustLevels: ["high"], allowedFields: [] });
    expect(byDefault.lostStolenCheckRequired).toBe(true);
    expect(byDefault.activeLivenessRequired).toBe(true);

    const optional = await service.create({ clientId: "acme-2", acceptedTrustLevels: ["high"], allowedFields: [], lostStolenCheckRequired: false });
    expect(optional.lostStolenCheckRequired).toBe(false);
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ lostStolenCheckRequired: false }) }));
  });

  it("rejette la création d'un clientId déjà existant", async () => {
    const { service } = buildService({ id: "kc-1", clientId: "acme-bank" });
    await expect(
      service.create({ clientId: "acme-bank", acceptedTrustLevels: ["high"], allowedFields: [] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("AdminKycClientsService.update", () => {
  it("lève une 404 pour un tenant inconnu", async () => {
    const { service } = buildService(null);
    await expect(service.update("inconnu", { active: false })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("AdminKycClientsService.rotateApiKey", () => {
  it("génère une nouvelle clé API différente de l'ancienne et la renvoie en clair", async () => {
    const { service } = buildService({ id: "kc-1", clientId: "acme-bank", apiKeyHash: "old-hash" });
    const result = await service.rotateApiKey("acme-bank");
    expect(result.apiKey).toMatch(/^emrtd_/);
    expect(result).not.toHaveProperty("apiKeyHash");
  });
});
