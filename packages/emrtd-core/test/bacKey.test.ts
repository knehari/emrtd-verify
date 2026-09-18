import { describe, it, expect } from "vitest";
import { buildMrzInformation, deriveBacSeed, deriveBacSessionKeys } from "../src/mrz/bacKey";

// Exemple de référence ICAO Doc 9303 Part 11 Appendix D.2 (même personne que l'exemple TD3
// de Part 4 Appendix B, réutilisé pour l'exemple de dérivation de clé BAC).
const referenceInput = { documentNumber: "L898902C3", dateOfBirth: "690806", dateOfExpiry: "940623" };

function hasOddParity(byte: number): boolean {
  let ones = 0;
  let v = byte;
  while (v) {
    ones += v & 1;
    v >>= 1;
  }
  return ones % 2 === 1;
}

describe("buildMrzInformation", () => {
  it("construit la chaîne de 24 caractères de l'exemple de référence ICAO", () => {
    // Numéro de document (9) + son chiffre de contrôle (déjà validé : 6, cf checkDigit.test.ts)
    // + date de naissance (6) + son chiffre de contrôle + date d'expiration (6) + son chiffre de contrôle.
    expect(buildMrzInformation(referenceInput)).toBe("L898902C3669080619406236");
  });

  it("bourre un numéro de document plus court avec '<'", () => {
    const result = buildMrzInformation({ ...referenceInput, documentNumber: "L8989" });
    expect(result.startsWith("L8989<<<<")).toBe(true);
  });
});

describe("deriveBacSeed", () => {
  it("produit 16 octets, de façon déterministe", async () => {
    const seed1 = await deriveBacSeed(referenceInput);
    const seed2 = await deriveBacSeed(referenceInput);
    expect(seed1).toHaveLength(16);
    expect(Array.from(seed1)).toEqual(Array.from(seed2));
  });
});

describe("deriveBacSessionKeys", () => {
  it("produit deux clés de 16 octets, chacune à parité DES impaire", async () => {
    const { kEnc, kMac } = await deriveBacSessionKeys(referenceInput);
    expect(kEnc).toHaveLength(16);
    expect(kMac).toHaveLength(16);
    for (const byte of kEnc) expect(hasOddParity(byte)).toBe(true);
    for (const byte of kMac) expect(hasOddParity(byte)).toBe(true);
  });

  it("KEnc et KMac sont différentes (compteurs de dérivation distincts)", async () => {
    const { kEnc, kMac } = await deriveBacSessionKeys(referenceInput);
    expect(Array.from(kEnc)).not.toEqual(Array.from(kMac));
  });

  it("est déterministe pour une même entrée", async () => {
    const first = await deriveBacSessionKeys(referenceInput);
    const second = await deriveBacSessionKeys(referenceInput);
    expect(Array.from(first.kEnc)).toEqual(Array.from(second.kEnc));
    expect(Array.from(first.kMac)).toEqual(Array.from(second.kMac));
  });

  it("des entrées différentes produisent des clés différentes", async () => {
    const a = await deriveBacSessionKeys(referenceInput);
    const b = await deriveBacSessionKeys({ ...referenceInput, dateOfExpiry: "990101" });
    expect(Array.from(a.kEnc)).not.toEqual(Array.from(b.kEnc));
  });
});
