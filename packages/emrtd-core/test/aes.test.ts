import { describe, it, expect } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";
import { aesCbcDecrypt, aesCbcEncrypt, aesCmac, aesCmac8, aesEcbEncryptBlock } from "../src/crypto/aes";

const hex = (s: string) => Uint8Array.from(Buffer.from(s.replace(/\s/g, ""), "hex"));
const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex");

describe("AES-CMAC — vecteurs officiels RFC 4493 §4", () => {
  const key = hex("2b7e151628aed2a6abf7158809cf4f3c");
  const message = hex(
    "6bc1bee22e409f96e93d7e117393172a ae2d8a571e03ac9c9eb76fac45af8e51 30c81c46a35ce411e5fbc1191a0a52ef f69f2445df4f9b17ad2b417be66c3710",
  );
  it.each([
    [0, "bb1d6929e95937287fa37d129b756746"],
    [16, "070a16b46b4d4144f79bdd9dd04a287c"],
    [40, "dfa66747de9ae63030ca32611497c827"],
    [64, "51f0bebf7e3b9d92fc49741779363cfe"],
  ])("message de %i octets", (length, expected) => {
    expect(toHex(aesCmac(key, message.subarray(0, length)))).toBe(expected);
  });

  it("aesCmac8 = 8 premiers octets du CMAC", () => {
    expect(toHex(aesCmac8(key, message))).toBe("51f0bebf7e3b9d92");
  });
});

describe("AES-CBC/ECB sans padding — identique à node:crypto", () => {
  it.each([16, 24, 32])("clé de %i octets", (keyLength) => {
    const key = Uint8Array.from(randomBytes(keyLength));
    const iv = Uint8Array.from(randomBytes(16));
    const data = Uint8Array.from(randomBytes(64));
    const reference = createCipheriv(`aes-${keyLength * 8}-cbc`, key, iv).setAutoPadding(false);
    const expected = Buffer.concat([reference.update(data), reference.final()]);
    const encrypted = aesCbcEncrypt(key, iv, data);
    expect(toHex(encrypted)).toBe(expected.toString("hex"));
    expect(toHex(aesCbcDecrypt(key, iv, encrypted))).toBe(toHex(data));

    const ecbRef = createCipheriv(`aes-${keyLength * 8}-ecb`, key, null).setAutoPadding(false);
    expect(toHex(aesEcbEncryptBlock(key, data.subarray(0, 16)))).toBe(ecbRef.update(data.subarray(0, 16)).toString("hex"));
  });

  it("refuse des données non alignées ou une clé de mauvaise taille", () => {
    expect(() => aesCbcEncrypt(new Uint8Array(16), new Uint8Array(16), new Uint8Array(15))).toThrow();
    expect(() => aesCbcEncrypt(new Uint8Array(15), new Uint8Array(16), new Uint8Array(16))).toThrow();
  });
});
