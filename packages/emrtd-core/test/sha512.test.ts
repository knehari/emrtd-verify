import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { sha384, sha512 } from "../src/crypto/sha512";
import { bufferToHex } from "../src/crypto/bytes";

describe("sha384/sha512", () => {
  it("produisent la bonne longueur (48/64 octets)", () => {
    expect(sha384(new TextEncoder().encode("abc"))).toHaveLength(48);
    expect(sha512(new TextEncoder().encode("abc"))).toHaveLength(64);
  });

  // Vecteurs FIPS 180-4 officiels (SHA384('')/SHA512('')), vérifiés indépendamment contre
  // node:crypto avant d'être codés en dur ici.
  it("SHA384('') correspond au vecteur FIPS 180-4 officiel", () => {
    expect(bufferToHex(sha384(new Uint8Array(0)))).toBe(
      "38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b",
    );
  });

  it("SHA512('') correspond au vecteur FIPS 180-4 officiel", () => {
    expect(bufferToHex(sha512(new Uint8Array(0)))).toBe(
      "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
    );
  });

  it("produisent exactement le même résultat que node:crypto pour une entrée arbitraire", () => {
    const data = new TextEncoder().encode("test d'entrée arbitraire pour cross-check 🔐");
    expect(bufferToHex(sha384(data))).toBe(createHash("sha384").update(data).digest("hex"));
    expect(bufferToHex(sha512(data))).toBe(createHash("sha512").update(data).digest("hex"));
  });

  it("sont déterministes", () => {
    const data = new TextEncoder().encode("déterminisme");
    expect(bufferToHex(sha384(data))).toBe(bufferToHex(sha384(data)));
    expect(bufferToHex(sha512(data))).toBe(bufferToHex(sha512(data)));
  });
});
