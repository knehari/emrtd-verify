import { describe, it, expect } from "vitest";
import { parseMrzTd3 } from "../src/mrz/mrzParser";

describe("parseMrzTd3", () => {
  // Exemple de référence ICAO Doc 9303 Part 4 Appendix B (document fictif).
  const line1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
  const line2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";

  it("parse les identifiants de base", () => {
    const result = parseMrzTd3(line1, line2);
    expect(result.identity.issuingState).toBe("UTO");
    expect(result.identity.documentNumber).toBe("L898902C3");
    expect(result.identity.nationality).toBe("UTO");
    expect(result.identity.primaryIdentifier).toBe("ERIKSSON");
    expect(result.identity.secondaryIdentifier).toBe("ANNA MARIA");
    expect(result.identity.sex).toBe("F");
  });

  it("valide les chiffres de contrôle du document de référence", () => {
    const result = parseMrzTd3(line1, line2);
    expect(result.validation.documentNumberValid).toBe(true);
    expect(result.validation.dateOfBirthValid).toBe(true);
    expect(result.validation.dateOfExpiryValid).toBe(true);
  });

  it("rejette une ligne de mauvaise longueur", () => {
    expect(() => parseMrzTd3("TROP_COURT", line2)).toThrow();
  });
});
