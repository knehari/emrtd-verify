import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { computeRetailMac, constantTimeEquals, padIso9797Method2, unpadIso9797Method2 } from "../src/crypto/retailMac";
import { singleDesDecryptBlock, singleDesEncryptBlock } from "../src/crypto/tripleDes";

describe("padIso9797Method2/unpadIso9797Method2", () => {
  it("ajoute un bloc de padding complet quand les données sont déjà alignées sur 8 octets (inconditionnel)", () => {
    const data = new Uint8Array(16).fill(0xaa);
    const padded = padIso9797Method2(data);
    expect(padded).toHaveLength(24);
    expect(padded[16]).toBe(0x80);
    expect(Array.from(padded.subarray(17))).toEqual(new Array(7).fill(0));
  });

  it("complète jusqu'au prochain multiple de 8 pour des données non alignées", () => {
    const data = new Uint8Array(5).fill(0x11);
    const padded = padIso9797Method2(data);
    expect(padded).toHaveLength(8);
    expect(padded[5]).toBe(0x80);
    expect(Array.from(padded.subarray(6))).toEqual([0, 0]);
  });

  it("round-trip : dépadder redonne exactement les données d'origine", () => {
    for (const length of [0, 1, 7, 8, 9, 15, 16, 32]) {
      const data = Uint8Array.from(randomBytes(length));
      const roundTripped = unpadIso9797Method2(padIso9797Method2(data));
      expect(Array.from(roundTripped)).toEqual(Array.from(data));
    }
  });

  it("rejette un padding absent ou corrompu", () => {
    expect(() => unpadIso9797Method2(new Uint8Array(8))).toThrow();
    expect(() => unpadIso9797Method2(Uint8Array.from([1, 2, 3, 0, 0, 0, 0, 0]))).toThrow();
  });
});

describe("computeRetailMac", () => {
  const key16 = Uint8Array.from(randomBytes(16));

  it("produit toujours 8 octets", () => {
    const mac = computeRetailMac(key16, padIso9797Method2(new Uint8Array(20)));
    expect(mac).toHaveLength(8);
  });

  it("est déterministe", () => {
    const data = padIso9797Method2(Uint8Array.from(randomBytes(20)));
    const a = computeRetailMac(key16, data);
    const b = computeRetailMac(key16, data);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("change si les données changent (même un seul bit, dans n'importe quel bloc)", () => {
    const data = padIso9797Method2(Uint8Array.from(randomBytes(24)));
    const tampered = Uint8Array.from(data);
    tampered[16] ^= 0x01; // dernier bloc de données
    const macOriginal = computeRetailMac(key16, data);
    const macTampered = computeRetailMac(key16, tampered);
    expect(Array.from(macOriginal)).not.toEqual(Array.from(macTampered));
  });

  it("change si la clé change", () => {
    const data = padIso9797Method2(Uint8Array.from(randomBytes(16)));
    const otherKey = Uint8Array.from(randomBytes(16));
    const a = computeRetailMac(key16, data);
    const b = computeRetailMac(otherKey, data);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("correspond à une ré-implémentation indépendante de l'algorithme (CBC-MAC DES simple avec K1, étape finale DES_encrypt(K1, DES_decrypt(K2, ·))), sur plusieurs blocs", () => {
    const k1 = key16.subarray(0, 8);
    const k2 = key16.subarray(8, 16);
    const data = padIso9797Method2(Uint8Array.from(randomBytes(37))); // > 4 blocs après padding

    // Ré-implémentation écrite indépendamment (chaînage manuel bloc par bloc), pour détecter une
    // erreur d'ordre XOR/chaînage dans computeRetailMac plutôt que de simplement re-tester le
    // même code.
    let chain = new Uint8Array(8);
    for (let offset = 0; offset < data.length; offset += 8) {
      const block = data.subarray(offset, offset + 8);
      const xored = new Uint8Array(8);
      for (let i = 0; i < 8; i++) xored[i] = chain[i] ^ block[i];
      chain = singleDesEncryptBlock(k1, xored);
    }
    const expected = singleDesEncryptBlock(k1, singleDesDecryptBlock(k2, chain));

    const actual = computeRetailMac(key16, data);
    expect(Array.from(actual)).toEqual(Array.from(expected));
  });

  it("rejette une clé qui ne fait pas 16 octets", () => {
    expect(() => computeRetailMac(new Uint8Array(8), padIso9797Method2(new Uint8Array(8)))).toThrow();
  });

  it("rejette des données non paddées (non multiples de 8)", () => {
    expect(() => computeRetailMac(key16, new Uint8Array(5))).toThrow();
  });
});

describe("constantTimeEquals", () => {
  it("retourne true pour des tableaux identiques", () => {
    const a = Uint8Array.from([1, 2, 3, 4]);
    const b = Uint8Array.from([1, 2, 3, 4]);
    expect(constantTimeEquals(a, b)).toBe(true);
  });

  it("retourne false si un seul octet diffère", () => {
    const a = Uint8Array.from([1, 2, 3, 4]);
    const b = Uint8Array.from([1, 2, 3, 5]);
    expect(constantTimeEquals(a, b)).toBe(false);
  });

  it("retourne false si les longueurs diffèrent", () => {
    expect(constantTimeEquals(new Uint8Array(4), new Uint8Array(5))).toBe(false);
  });
});
