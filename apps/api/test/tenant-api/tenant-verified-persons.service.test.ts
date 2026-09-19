import { describe, it, expect, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { TenantVerifiedPersonsService } from "../../src/modules/tenant-api/tenant-verified-persons.service";

function buildService(person: unknown) {
  const findUnique = vi.fn().mockResolvedValue(person);
  const update = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "vp-1", ...data }));
  const groupBy = vi.fn().mockResolvedValue([]);
  const count = vi.fn().mockResolvedValue(0);
  const findMany = vi.fn().mockResolvedValue([]);
  const prisma = {
    verifiedPerson: { findUnique, update, groupBy, findMany, count },
    $transaction: vi.fn().mockResolvedValue([0, []]),
  } as never;
  return { service: new TenantVerifiedPersonsService(prisma), findUnique, update, groupBy };
}

describe("TenantVerifiedPersonsService.get — isolation multi-tenant", () => {
  it("renvoie la fiche quand elle appartient au tenant appelant", async () => {
    const { service } = buildService({ id: "vp-1", kycClientId: "acme-bank", status: "VERIFIED" });
    const result = await service.get("acme-bank", "vp-1");
    expect(result).toMatchObject({ id: "vp-1" });
  });

  it("lève une 404 (jamais 403) quand la fiche appartient à un AUTRE tenant", async () => {
    const { service } = buildService({ id: "vp-1", kycClientId: "other-bank", status: "VERIFIED" });
    await expect(service.get("acme-bank", "vp-1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("lève une 404 quand la fiche n'existe pas du tout", async () => {
    const { service } = buildService(null);
    await expect(service.get("acme-bank", "vp-inconnu")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("TenantVerifiedPersonsService.updateStatus", () => {
  it("refuse de modifier une fiche d'un autre tenant", async () => {
    const { service, update } = buildService({ id: "vp-1", kycClientId: "other-bank", status: "VERIFIED" });
    await expect(service.updateStatus("acme-bank", "vp-1", { status: "WATCHLIST", watchlistReason: "test" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("efface watchlistReason quand le statut n'est plus WATCHLIST", async () => {
    const { service, update } = buildService({ id: "vp-1", kycClientId: "acme-bank", status: "WATCHLIST" });
    await service.updateStatus("acme-bank", "vp-1", { status: "VERIFIED" });
    expect(update).toHaveBeenCalledWith({ where: { id: "vp-1" }, data: { status: "VERIFIED", watchlistReason: null } });
  });

  it("enregistre le motif quand le statut passe à WATCHLIST", async () => {
    const { service, update } = buildService({ id: "vp-1", kycClientId: "acme-bank", status: "VERIFIED" });
    await service.updateStatus("acme-bank", "vp-1", { status: "WATCHLIST", watchlistReason: "activité suspecte" });
    expect(update).toHaveBeenCalledWith({
      where: { id: "vp-1" },
      data: { status: "WATCHLIST", watchlistReason: "activité suspecte" },
    });
  });
});

describe("TenantVerifiedPersonsService.stats", () => {
  it("renvoie des compteurs à zéro pour les statuts sans ligne", async () => {
    const { service } = buildService(null);
    const stats = await service.stats("acme-bank");
    expect(stats).toEqual({ VERIFIED: 0, UNVERIFIED: 0, PENDING_REVIEW: 0, WATCHLIST: 0 });
  });
});
