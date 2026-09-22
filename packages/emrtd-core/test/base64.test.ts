import { describe, it, expect } from "vitest";
import { bytesToBase64, base64ToBytes } from "../src/crypto/base64";

function bytesOf(text: string): Uint8Array {
  return Uint8Array.from(Array.from(text).map((c) => c.charCodeAt(0)));
}

describe("bytesToBase64", () => {
  // Vecteurs de référence produits par Buffer.from(v, "binary").toString("base64") (node:buffer),
  // couvrant les 3 restes possibles (0/1/2 octets) et les octets non-ASCII.
  it.each([
    ["", ""],
    ["a", "YQ=="],
    ["ab", "YWI="],
    ["abc", "YWJj"],
    ["abcd", "YWJjZA=="],
    ["hello world", "aGVsbG8gd29ybGQ="],
  ])("encode %j en %s", (input, expected) => {
    expect(bytesToBase64(bytesOf(input))).toBe(expected);
  });

  it("encode tous les octets 0x00-0xFF comme node:buffer", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(bytesToBase64(bytes)).toBe(
      "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+P0BBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWltcXV5fYGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn+AgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2en6ChoqOkpaanqKmqq6ytrq+wsbKztLW2t7i5uru8vb6/wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t/g4eLj5OXm5+jp6uvs7e7v8PHy8/T19vf4+fr7/P3+/w==",
    );
  });
});

describe("base64ToBytes", () => {
  it("round-trip byte-exact avec bytesToBase64 pour tous les octets 0x00-0xFF", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("décode correctement une chaîne connue", () => {
    expect(base64ToBytes("aGVsbG8gd29ybGQ=")).toEqual(bytesOf("hello world"));
  });

  it("décode correctement sans padding final requis pour la lecture (padding ignoré si absent)", () => {
    expect(base64ToBytes("YWJj")).toEqual(bytesOf("abc"));
  });

  it("renvoie un tampon vide pour une entrée vide", () => {
    expect(base64ToBytes("")).toEqual(new Uint8Array(0));
  });
});
