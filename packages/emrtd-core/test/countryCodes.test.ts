import { describe, it, expect } from "vitest";
import { sameCountry, toAlpha2CountryCode, toAlpha3CountryCode } from "../src/mrz/countryCodes";

describe("countryCodes", () => {
  it("rapproche un code MRZ alpha-3 de l'attribut C alpha-2 d'une CSCA", () => {
    expect(sameCountry("FRA", "FR")).toBe(true);
    expect(sameCountry("DZA", "DZ")).toBe(true);
    expect(sameCountry("D<<", "DE")).toBe(true);
    expect(sameCountry("FRA", "DE")).toBe(false);
  });

  it("rapproche le Kosovo (RKS en MRZ) de ses CSCA signés C=KS", () => {
    expect(toAlpha2CountryCode("KS")).toBe("XK");
    expect(sameCountry("RKS", "KS")).toBe(true);
    expect(sameCountry("RKS", "XK")).toBe(true);
  });

  it("accepte deux codes identiques sans équivalent alpha-2", () => {
    expect(toAlpha2CountryCode("UTO")).toBeUndefined();
    expect(sameCountry("UTO", "UTO")).toBe(true);
  });

  it("retrouve l'alpha-3 de la MRZ depuis l'alpha-2 d'une CSCA", () => {
    expect(toAlpha3CountryCode("DZ")).toBe("DZA");
    expect(toAlpha3CountryCode("fr")).toBe("FRA");
    expect(toAlpha3CountryCode("KS")).toBe("RKS");
    expect(toAlpha3CountryCode("ZZ")).toBeUndefined();
  });
});
