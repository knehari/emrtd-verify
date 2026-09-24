import { describe, it, expect } from "vitest";
import { createECDH, randomBytes } from "node:crypto";
import { bytesToBigInt, decodePoint, encodePoint, standardizedEcDomain } from "../src/crypto/ecCurves";

const OPENSSL_NAMES: Record<number, string> = {
  8: "prime192v1",
  9: "brainpoolP192r1",
  10: "secp224r1",
  11: "brainpoolP224r1",
  12: "prime256v1",
  13: "brainpoolP256r1",
  14: "brainpoolP320r1",
  15: "secp384r1",
  16: "brainpoolP384r1",
  17: "brainpoolP512r1",
  18: "secp521r1",
};

describe("courbes standardisées PACE — identiques à OpenSSL (node:crypto)", () => {
  it.each(Object.entries(OPENSSL_NAMES))("paramètres %s (%s)", (id, opensslName) => {
    const domain = standardizedEcDomain(Number(id));
    expect(domain).toBeDefined();
    const d = domain!;
    // n·G = point à l'infini : l'ordre est correct pour ce générateur.
    expect(d.Point.BASE.multiply(d.order - 1n).add(d.Point.BASE).equals(d.Point.ZERO)).toBe(true);

    for (let i = 0; i < 3; i++) {
      const privateKey = (bytesToBigInt(Uint8Array.from(randomBytes(d.fieldLength + 8))) % (d.order - 1n)) + 1n;
      const privateBytes = Buffer.from(privateKey.toString(16).padStart(d.fieldLength * 2, "0"), "hex");
      const ecdh = createECDH(opensslName);
      ecdh.setPrivateKey(privateBytes);
      const expected = ecdh.getPublicKey();
      const actual = encodePoint(d, d.Point.BASE.multiply(privateKey));
      expect(Buffer.from(actual).toString("hex")).toBe(expected.toString("hex"));
      expect(decodePoint(d, actual).equals(d.Point.BASE.multiply(privateKey))).toBe(true);
    }
  });

  it("identifiants non EC (0–2 MODP, 3–7 réservés) ou inconnus → undefined", () => {
    for (const id of [0, 1, 2, 3, 7, 19, 32]) expect(standardizedEcDomain(id)).toBeUndefined();
  });

  it("decodePoint refuse un point hors courbe ou mal encodé", () => {
    const d = standardizedEcDomain(13)!;
    const valid = encodePoint(d, d.Point.BASE);
    const offCurve = Uint8Array.from(valid);
    offCurve[offCurve.length - 1] ^= 1;
    expect(() => decodePoint(d, offCurve)).toThrow();
    expect(() => decodePoint(d, valid.subarray(1))).toThrow();
  });
});
