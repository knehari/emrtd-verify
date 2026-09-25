import { describe, it, expect, vi } from "vitest";
import { CscaStoreService, countryCodeVariants } from "../../src/modules/pki/csca-store.service";
import type { PrismaService } from "../../src/modules/prisma/prisma.service";

function storeWith(records: Array<{ countryCode: string }>) {
  const findMany = vi.fn(async ({ where }: { where: { countryCode: { in: string[] } } }) =>
    records
      .filter((r) => where.countryCode.in.includes(r.countryCode))
      .map((r) => ({
        ...r,
        certificateDer: Buffer.from([0x30, 0x00]),
        subject: `CN=CSCA ${r.countryCode}`,
        serialNumber: "01",
        notBefore: new Date("2020-01-01T00:00:00Z"),
        notAfter: new Date("2035-01-01T00:00:00Z"),
      })),
  );
  const prisma = {
    cscaTrustState: { findUnique: vi.fn(async () => ({ activeBatchId: "batch-1" })) },
    cscaCertificateRecord: { findMany },
  } as unknown as PrismaService;
  return { store: new CscaStoreService(prisma), findMany };
}

describe("CscaStoreService.getAnchorsForCountry", () => {
  it("trouve les CSCA enregistrés en alpha-2 (C= du certificat) pour un code MRZ alpha-3", async () => {
    // Bug corrigé : la MRZ donne « FRA », la Master List enregistre « FR » — NO_TRUST_ANCHOR à tort.
    const { store } = storeWith([{ countryCode: "FR" }, { countryCode: "DZ" }]);
    const anchors = await store.getAnchorsForCountry("FRA");
    expect(anchors.map((a) => a.countryCode)).toEqual(["FR"]);
  });

  it("accepte aussi un code déjà en alpha-2 et les codes MRZ particuliers (D pour l'Allemagne)", async () => {
    const { store } = storeWith([{ countryCode: "DE" }, { countryCode: "DZ" }]);
    expect((await store.getAnchorsForCountry("DZ")).map((a) => a.countryCode)).toEqual(["DZ"]);
    expect((await store.getAnchorsForCountry("D<<")).map((a) => a.countryCode)).toEqual(["DE"]);
  });
});

describe("countryCodeVariants", () => {
  it("donne les deux formes, et laisse seul un code sans équivalent ISO", () => {
    expect(countryCodeVariants("FRA").sort()).toEqual(["FR", "FRA"]);
    expect(countryCodeVariants("fr").sort()).toEqual(["FR", "FRA"]);
    expect(countryCodeVariants("UTO")).toEqual(["UTO"]);
  });
});
