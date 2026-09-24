import { describe, expect, it } from "vitest";
import { embeddedCountryCscas, embeddedCountryRows, foldForSearch, matchesCountrySearch } from "../../src/authentik/trustStoreSummary";

const rows = embeddedCountryRows("fr", "ancres");
const search = (q: string) => rows.filter((r) => matchesCountrySearch(r, q)).map((r) => r.code);

describe("recherche de pays", () => {
  it("ignore la casse et les accents", () => {
    expect(foldForSearch("Algérie Égypte Œ")).toBe("algerie egypte oe");
    expect(search("algerie")).toEqual(["DZ"]);
    expect(search("ALGÉ")).toEqual(["DZ"]);
  });

  it("trouve un pays par son code alpha-2, son alpha-3 MRZ ou son nom anglais", () => {
    expect(search("DZA")).toContain("DZ");
    expect(search("fr")).toContain("FR");
    expect(search("germany")).toEqual(["DE"]);
  });

  it("exige chaque mot saisi, en début de mot", () => {
    expect(search("royaume uni")).toEqual(["GB"]);
    expect(search("uni")).toEqual(expect.arrayContaining(["GB", "US", "AE"]));
    expect(search("zzzz")).toEqual([]);
    expect(search("  ")).toHaveLength(rows.length);
  });
});

describe("embeddedCountryCscas", () => {
  it("décode tous les CSCA d'un pays, valides en premier", () => {
    const now = new Date("2026-09-24T00:00:00Z");
    const dz = embeddedCountryCscas("DZA", now);
    expect(dz).toHaveLength(3);
    expect(dz.every((c) => c.commonName === "CSCA-ALGERIA" && c.organisation.startsWith("Gov"))).toBe(true);
    expect(dz.map((c) => c.status)).toEqual(["valid", "valid", "valid"]);
    // N° 112122A5… ne vérifie pas sa propre signature mais celle d'un autre CSCA algérien (contrôle
    // fait hors app, voir le commit de la Master List allemande) : c'est le certificat de lien.
    expect(dz.filter((c) => c.isLink).map((c) => c.serialNumber.slice(0, 8))).toEqual(["112122A5"]);
    expect(dz[0].fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });

  it("classe les CSCA expirés en dernier et décrit clé et signature", () => {
    const fr = embeddedCountryCscas("FR", new Date("2026-09-24T00:00:00Z"));
    const order = fr.map((c) => c.status);
    expect(order.indexOf("expired")).toBeGreaterThan(order.lastIndexOf("valid"));
    expect(fr.every((c) => /^(RSA \d+ bits|ECDSA .+)$/.test(c.keyAlgorithm))).toBe(true);
    expect(fr.every((c) => c.signatureAlgorithm.length > 0)).toBe(true);
  });
});
