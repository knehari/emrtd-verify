import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { sha256, sha256Hex } from "../src/crypto/sha256";

describe("sha256", () => {
  it("produit 32 octets", () => {
    expect(sha256(new TextEncoder().encode("abc"))).toHaveLength(32);
  });

  // Vecteur FIPS 180-4 officiel (SHA256('') = e3b0c44...b855, 64 hex), vérifié indépendamment
  // contre node:crypto avant d'être codé en dur ici.
  it("SHA256('') correspond au vecteur FIPS 180-4 officiel", () => {
    expect(sha256Hex(new Uint8Array(0))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex(new Uint8Array(0))).toHaveLength(64);
  });

  it("SHA256('abc') correspond exactement à node:crypto (vecteur FIPS 180 bien connu)", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(createHash("sha256").update("abc").digest("hex"));
  });

  it("produit exactement le même résultat que node:crypto pour une entrée aléatoire", () => {
    const data = new TextEncoder().encode("test d'entrée arbitraire pour cross-check 🔐");
    expect(sha256Hex(data)).toBe(createHash("sha256").update(data).digest("hex"));
  });

  it("est déterministe", () => {
    const data = new TextEncoder().encode("déterminisme");
    expect(sha256Hex(data)).toBe(sha256Hex(data));
  });

  it("des entrées différentes produisent des empreintes différentes", () => {
    expect(sha256Hex(new TextEncoder().encode("a"))).not.toBe(sha256Hex(new TextEncoder().encode("b")));
  });
});
