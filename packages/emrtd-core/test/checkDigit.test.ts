import { describe, it, expect } from "vitest";
import { computeCheckDigit, verifyCheckDigit } from "../src/mrz/checkDigit";

describe("computeCheckDigit", () => {
  // Exemple officiel ICAO Doc 9303 Part 3 §4.9 (numéro de document "L898902C3").
  it("reproduit l'exemple de référence ICAO Doc 9303", () => {
    expect(computeCheckDigit("L898902C36")).toBe(computeCheckDigit("L898902C36"));
    expect(computeCheckDigit("L898902C3")).toBe(6);
  });

  it("traite '<' comme valeur 0", () => {
    expect(computeCheckDigit("<<<<<<<<<")).toBe(0);
  });

  it("calcule correctement une date MRZ (YYMMDD)", () => {
    // 740812 -> chiffre de contrôle attendu 2 (exemple ICAO Doc 9303)
    expect(computeCheckDigit("740812")).toBe(2);
  });
});

describe("verifyCheckDigit", () => {
  it("valide un chiffre de contrôle correct", () => {
    expect(verifyCheckDigit("L898902C3", "6")).toBe(true);
  });

  it("rejette un chiffre de contrôle incorrect", () => {
    expect(verifyCheckDigit("L898902C3", "0")).toBe(false);
  });

  it("accepte '<' uniquement sur un champ vide", () => {
    expect(verifyCheckDigit("<<<<<<<<<", "<")).toBe(true);
    expect(verifyCheckDigit("L898902C3", "<")).toBe(false);
  });
});
