import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { sha1 } from "../src/crypto/sha1";

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

describe("sha1", () => {
  it("produit 20 octets", () => {
    expect(sha1(new TextEncoder().encode("abc"))).toHaveLength(20);
  });

  // Vecteurs FIPS 180-1/180-4 officiels, reproductibles indépendamment (pas une source secondaire).
  it("SHA1('') = da39a3ee5e6b4b0d3255bfef95601890afd80709", () => {
    expect(hex(sha1(new Uint8Array(0)))).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
  });

  it("SHA1('abc') correspond exactement à node:crypto (vecteur FIPS 180 bien connu)", () => {
    expect(hex(sha1(new TextEncoder().encode("abc")))).toBe(createHash("sha1").update("abc").digest("hex"));
  });

  it("SHA1('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq') correspond exactement à node:crypto (vecteur FIPS 180 bien connu)", () => {
    const input = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
    expect(hex(sha1(new TextEncoder().encode(input)))).toBe(createHash("sha1").update(input).digest("hex"));
  });

  it("produit exactement le même résultat que node:crypto pour une entrée aléatoire", () => {
    const data = new TextEncoder().encode("test d'entrée arbitraire pour cross-check 🔐");
    const expected = createHash("sha1").update(data).digest("hex");
    expect(hex(sha1(data))).toBe(expected);
  });

  it("est déterministe", () => {
    const data = new TextEncoder().encode("déterminisme");
    expect(hex(sha1(data))).toBe(hex(sha1(data)));
  });

  it("des entrées différentes produisent des empreintes différentes", () => {
    expect(hex(sha1(new TextEncoder().encode("a")))).not.toBe(hex(sha1(new TextEncoder().encode("b"))));
  });
});
