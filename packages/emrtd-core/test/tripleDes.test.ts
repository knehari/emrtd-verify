import { describe, it, expect } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";
import { singleDesDecryptBlock, singleDesEncryptBlock, tripleDesCbcDecrypt, tripleDesCbcEncrypt } from "../src/crypto/tripleDes";

// Vecteurs FIPS 46-3/SP 800-67 génériques (mêmes valeurs que des.js@1.1.0 test/ede-test.js) —
// vérifient seulement que notre wrapper produit un 3DES-CBC correct en général. L'exemple
// travaillé BAC officiel de l'ICAO Doc 9303 Part 11 Appendix D.2/D.3 (byte-exact, confirmé
// contre les pages scannées de la spécification fournies par l'utilisateur) est couvert par
// bac.test.ts (E_IFD = 3DES-CBC(KEnc, RND.IFD||RND.IC||K.IFD)) et bacKey.test.ts.
const genericKey16 = Uint8Array.from(Buffer.from("133457799bbcdff1" + "0000000000000000", "hex"));
const genericIv8 = Uint8Array.from(Buffer.from("0102030405060708", "hex"));
const genericData16 = Uint8Array.from(Buffer.from("0123456789abcdeffedcba9876543210", "hex"));

describe("tripleDesCbcEncrypt/tripleDesCbcDecrypt", () => {
  it("produit exactement le même résultat que node:crypto des-ede3-cbc pour une clé à 2 clés étendue en K1||K2||K1", () => {
    const threeKeyForNode = Buffer.concat([Buffer.from(genericKey16), Buffer.from(genericKey16.subarray(0, 8))]);
    const cipher = createCipheriv("des-ede3-cbc", threeKeyForNode, Buffer.from(genericIv8));
    cipher.setAutoPadding(false);
    const expected = Buffer.concat([cipher.update(Buffer.from(genericData16)), cipher.final()]);

    const actual = tripleDesCbcEncrypt(genericKey16, genericIv8, genericData16);

    expect(Buffer.from(actual).equals(expected)).toBe(true);
  });

  it("round-trip : déchiffrer le résultat d'un chiffrement redonne les données d'origine", () => {
    const encrypted = tripleDesCbcEncrypt(genericKey16, genericIv8, genericData16);
    const decrypted = tripleDesCbcDecrypt(genericKey16, genericIv8, encrypted);
    expect(Array.from(decrypted)).toEqual(Array.from(genericData16));
  });

  it("round-trip avec une clé et des données aléatoires (plusieurs blocs)", () => {
    const key16 = Uint8Array.from(randomBytes(16));
    const iv8 = Uint8Array.from(randomBytes(8));
    const data = Uint8Array.from(randomBytes(8 * 5));

    const encrypted = tripleDesCbcEncrypt(key16, iv8, data);
    expect(encrypted).toHaveLength(data.length);
    const decrypted = tripleDesCbcDecrypt(key16, iv8, encrypted);
    expect(Array.from(decrypted)).toEqual(Array.from(data));
  });

  it("rejette des données dont la longueur n'est pas un multiple de 8", () => {
    expect(() => tripleDesCbcEncrypt(genericKey16, genericIv8, new Uint8Array(7))).toThrow();
  });

  it("rejette une clé qui ne fait pas 16 octets", () => {
    expect(() => tripleDesCbcEncrypt(new Uint8Array(10), genericIv8, genericData16)).toThrow();
  });

  it("des clés différentes produisent des chiffrés différents", () => {
    const a = tripleDesCbcEncrypt(genericKey16, genericIv8, genericData16);
    const otherKey = Uint8Array.from(randomBytes(16));
    const b = tripleDesCbcEncrypt(otherKey, genericIv8, genericData16);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

describe("singleDesEncryptBlock/singleDesDecryptBlock", () => {
  it("produit exactement le même résultat que node:crypto des-ecb pour un bloc unique", () => {
    const key8 = Uint8Array.from(Buffer.from("133457799bbcdff1", "hex"));
    const block8 = Uint8Array.from(Buffer.from("0123456789abcdef", "hex"));

    // node:crypto (OpenSSL 3, sans provider "legacy") ne supporte plus le DES simple isolément
    // ("des-ecb"/"des-cbc" : "digital envelope routines::unsupported") — seul le 3DES reste
    // disponible. On croise donc singleDesEncryptBlock contre tripleDesCbcEncrypt (déjà vérifié
    // ci-dessus contre node:crypto) via le cas dégénéré du 3DES-EDE : avec K1=K2=K, EDE =
    // E_K(D_K(E_K(x))) = E_K(x), identité mathématique du mode EDE (pas un vecteur mémorisé).
    const key16SameKeyTwice = Uint8Array.from(Buffer.concat([Buffer.from(key8), Buffer.from(key8)]));
    const zeroIv8 = new Uint8Array(8);
    const expected = tripleDesCbcEncrypt(key16SameKeyTwice, zeroIv8, block8);

    const actual = singleDesEncryptBlock(key8, block8);
    expect(Array.from(actual)).toEqual(Array.from(expected));
  });

  it("round-trip : déchiffrer un bloc chiffré redonne le bloc d'origine", () => {
    const key8 = Uint8Array.from(randomBytes(8));
    const block8 = Uint8Array.from(randomBytes(8));
    const encrypted = singleDesEncryptBlock(key8, block8);
    const decrypted = singleDesDecryptBlock(key8, encrypted);
    expect(Array.from(decrypted)).toEqual(Array.from(block8));
  });
});
