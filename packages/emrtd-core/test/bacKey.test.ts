import { describe, it, expect } from "vitest";
import { buildMrzInformation, deriveBacSeed, deriveBacSessionKeys } from "../src/mrz/bacKey";

// Exemple de référence ICAO Doc 9303 Part 11 Appendix D.2 ("TD2 MRZ, document number 9
// characters", passeport d'Anna Maria Eriksson) — CONFIRMÉ byte-exact contre les pages
// scannées de la spécification (App D-2/D-3, fournies par l'utilisateur) : le numéro de
// document réel est "L898902C<" (8 caractères + un caractère de bourrage '<' pour atteindre 9),
// chiffre de contrôle 3 — PAS "L898902C3" (9 caractères, chiffre de contrôle 6) comme
// précédemment supposé ici sans accès à la source primaire.
const referenceInput = { documentNumber: "L898902C<", dateOfBirth: "690806", dateOfExpiry: "940623" };

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex").toUpperCase();
}

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
  it("construit la chaîne de 24 caractères de l'exemple de référence ICAO (Appendix D.2, confirmé byte-exact)", () => {
    expect(buildMrzInformation(referenceInput)).toBe("L898902C<369080619406236");
  });

  it("bourre un numéro de document plus court avec '<'", () => {
    const result = buildMrzInformation({ ...referenceInput, documentNumber: "L8989" });
    expect(result.startsWith("L8989<<<<")).toBe(true);
  });
});

describe("deriveBacSeed", () => {
  it("produit le Kseed exact de l'exemple ICAO Appendix D.2 (confirmé contre la spécification scannée)", async () => {
    const seed = await deriveBacSeed(referenceInput);
    expect(hex(seed)).toBe("239AB9CB282DAF66231DC5A4DF6BFBAE");
  });

  it("produit 16 octets, de façon déterministe", async () => {
    const seed1 = await deriveBacSeed(referenceInput);
    const seed2 = await deriveBacSeed(referenceInput);
    expect(seed1).toHaveLength(16);
    expect(Array.from(seed1)).toEqual(Array.from(seed2));
  });
});

describe("deriveBacSessionKeys", () => {
  it("produit KEnc/KMac exacts de l'exemple ICAO Appendix D.2 (confirmé contre la spécification scannée)", async () => {
    const { kEnc, kMac } = await deriveBacSessionKeys(referenceInput);
    expect(hex(kEnc)).toBe("AB94FDECF2674FDFB9B391F85D7F76F2");
    expect(hex(kMac)).toBe("7962D9ECE03D1ACD4C76089DCE131543");
  });

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
