import { describe, it, expect, vi } from "vitest";
import { VerifiedPersonService } from "../../src/modules/verified-person/verified-person.service";

function buildService(existing: unknown) {
  const findUnique = vi.fn().mockResolvedValue(existing);
  const update = vi.fn().mockResolvedValue(undefined);
  const create = vi.fn().mockResolvedValue(undefined);
  const prisma = { verifiedPerson: { findUnique, update, create } } as never;
  return { service: new VerifiedPersonService(prisma), findUnique, update, create };
}

describe("VerifiedPersonService.computeMatchKey", () => {
  it("est déterministe pour les mêmes valeurs", () => {
    const a = VerifiedPersonService.computeMatchKey("ePassport", "FRA", "12AB34567", "900101");
    const b = VerifiedPersonService.computeMatchKey("ePassport", "FRA", "12AB34567", "900101");
    expect(a).toBe(b);
  });

  it("normalise la casse et les espaces du numéro de document", () => {
    const a = VerifiedPersonService.computeMatchKey("ePassport", "FRA", "12ab34567", "900101");
    const b = VerifiedPersonService.computeMatchKey("ePassport", "FRA", " 12AB34567 ", "900101");
    expect(a).toBe(b);
  });

  it("un numéro de document différent produit une clé différente", () => {
    const a = VerifiedPersonService.computeMatchKey("ePassport", "FRA", "12AB34567", "900101");
    const b = VerifiedPersonService.computeMatchKey("ePassport", "FRA", "99ZZ99999", "900101");
    expect(a).not.toBe(b);
  });

  it("ne contient jamais le numéro de document en clair (hachage SHA-256)", () => {
    const key = VerifiedPersonService.computeMatchKey("ePassport", "FRA", "12AB34567", "900101");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("12AB34567");
  });
});

describe("VerifiedPersonService.linkVerification", () => {
  const baseParams = {
    kycClientId: "acme-bank",
    verificationRecordId: "vr-1",
    documentType: "ePassport",
    issuingCountry: "FRA",
    documentNumber: "12AB34567",
    dateOfBirth: "900101",
    verdict: "authentic" as const,
    displayFields: { documentNumber: { value: "12AB34567", valid: true, checks: ["checkDigit"] } },
  };

  it("crée une nouvelle fiche VERIFIED pour un verdict authentic sans fiche existante", async () => {
    const { service, create } = buildService(null);
    await service.linkVerification(baseParams);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kycClientId: "acme-bank",
          status: "VERIFIED",
          documentType: "ePassport",
          issuingCountry: "FRA",
          verificationCount: 1,
          verifications: { connect: { id: "vr-1" } },
        }),
      }),
    );
  });

  it("mappe rejected vers UNVERIFIED", async () => {
    const { service, create } = buildService(null);
    await service.linkVerification({ ...baseParams, verdict: "rejected" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "UNVERIFIED" }) }));
  });

  it("mappe manual_review_required et suspicious vers PENDING_REVIEW", async () => {
    const { service: s1, create: c1 } = buildService(null);
    await s1.linkVerification({ ...baseParams, verdict: "manual_review_required" });
    expect(c1).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PENDING_REVIEW" }) }));

    const { service: s2, create: c2 } = buildService(null);
    await s2.linkVerification({ ...baseParams, verdict: "suspicious" });
    expect(c2).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PENDING_REVIEW" }) }));
  });

  it("met à jour une fiche existante et incrémente verificationCount", async () => {
    const { service, update } = buildService({ id: "vp-1", status: "PENDING_REVIEW" });
    await service.linkVerification(baseParams);

    expect(update).toHaveBeenCalledWith({
      where: { id: "vp-1" },
      data: expect.objectContaining({
        status: "VERIFIED",
        verificationCount: { increment: 1 },
        verifications: { connect: { id: "vr-1" } },
      }),
    });
  });

  it("ne modifie jamais un statut WATCHLIST existant, même avec un verdict authentic", async () => {
    const { service, update } = buildService({ id: "vp-1", status: "WATCHLIST" });
    await service.linkVerification(baseParams);

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "WATCHLIST" }) }));
  });
});
