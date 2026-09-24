import { describe, it, expect } from "vitest";
import { createPublicKey, generateKeyPairSync, sign, constants } from "node:crypto";
import { BitString, Integer, ObjectIdentifier, OctetString, Sequence } from "asn1js";
import { verifySignaturePure } from "../src/crypto/pureVerify";
import { bigIntToBytes, standardizedEcDomain } from "../src/crypto/ecCurves";

const data = new TextEncoder().encode("LDSSecurityObject — données signées de test");
const spkiOf = (key: ReturnType<typeof generateKeyPairSync>["publicKey"]) => new Uint8Array(key.export({ type: "spki", format: "der" }));
const tamper = (bytes: Uint8Array) => {
  const copy = Uint8Array.from(bytes);
  copy[copy.length - 5] ^= 0x01;
  return copy;
};

describe("verifySignaturePure — RSA, identique à OpenSSL (node:crypto)", () => {
  it.each([
    [2048, "SHA-256", "sha256"],
    [2048, "SHA-1", "sha1"],
    [3072, "SHA-512", "sha512"],
    [2049, "SHA-384", "sha384"],
  ] as const)("PKCS#1 v1.5, RSA %i / %s", (bits, hash, nodeHash) => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: bits });
    const signature = new Uint8Array(sign(nodeHash, data, privateKey));
    const scheme = { kind: "RSASSA-PKCS1-v1_5" as const, hash };
    expect(verifySignaturePure({ spkiDer: spkiOf(publicKey), scheme, signature, signedData: data })).toBe(true);
    expect(verifySignaturePure({ spkiDer: spkiOf(publicKey), scheme, signature: tamper(signature), signedData: data })).toBe(false);
    expect(verifySignaturePure({ spkiDer: spkiOf(publicKey), scheme, signature, signedData: tamper(data) })).toBe(false);
  });

  it.each([
    [2048, "SHA-256", "sha256", 32],
    [3072, "SHA-512", "sha512", 64],
    [2049, "SHA-256", "sha256", 32],
    [2047, "SHA-384", "sha384", 20],
  ] as const)("RSA-PSS, RSA %i / %s / sel %i", (bits, hash, nodeHash, saltLength) => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: bits });
    const signature = new Uint8Array(sign(nodeHash, data, { key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength }));
    const scheme = { kind: "RSA-PSS" as const, hash, saltLength };
    expect(verifySignaturePure({ spkiDer: spkiOf(publicKey), scheme, signature, signedData: data })).toBe(true);
    expect(verifySignaturePure({ spkiDer: spkiOf(publicKey), scheme, signature: tamper(signature), signedData: data })).toBe(false);
  });
});

describe("verifySignaturePure — ECDSA, identique à OpenSSL (node:crypto)", () => {
  it.each([
    ["prime256v1", "SHA-256", "sha256"],
    ["secp384r1", "SHA-384", "sha384"],
    ["secp521r1", "SHA-512", "sha512"],
    ["secp224r1", "SHA-224", "sha224"],
    ["brainpoolP256r1", "SHA-256", "sha256"],
    ["brainpoolP320r1", "SHA-256", "sha256"],
    ["brainpoolP384r1", "SHA-384", "sha384"],
    ["brainpoolP512r1", "SHA-512", "sha512"],
    ["brainpoolP224r1", "SHA-1", "sha1"],
  ] as const)("%s / %s, signature DER et plain r||s", (curve, hash, nodeHash) => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: curve });
    const scheme = { kind: "ECDSA" as const, hash };
    const der = new Uint8Array(sign(nodeHash, data, privateKey));
    const plain = new Uint8Array(sign(nodeHash, data, { key: privateKey, dsaEncoding: "ieee-p1363" }));
    expect(verifySignaturePure({ spkiDer: spkiOf(publicKey), scheme, signature: der, signedData: data })).toBe(true);
    expect(verifySignaturePure({ spkiDer: spkiOf(publicKey), scheme, signature: plain, signedData: data })).toBe(true);
    expect(verifySignaturePure({ spkiDer: spkiOf(publicKey), scheme, signature: der, signedData: tamper(data) })).toBe(false);
    expect(verifySignaturePure({ spkiDer: spkiOf(publicKey), scheme, signature: tamper(plain), signedData: data })).toBe(false);
  });

  it("clé EC à paramètres de courbe explicites (RFC 3279 §2.3.5), comme chez certaines CSCA", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "brainpoolP256r1" });
    const domain = standardizedEcDomain(13)!;
    const c = domain.Point.CURVE();
    const L = domain.fieldLength;
    const namedSpki = spkiOf(publicKey);
    const point = namedSpki.subarray(namedSpki.length - (1 + 2 * L)); // point non compressé en fin de SPKI
    expect(point[0]).toBe(0x04);
    const int = (v: bigint) => Integer.fromBigInt(v);
    const ecParameters = new Sequence({
      value: [
        new Integer({ value: 1 }),
        new Sequence({ value: [new ObjectIdentifier({ value: "1.2.840.10045.1.1" }), int(c.p)] }),
        new Sequence({ value: [new OctetString({ valueHex: bigIntToBytes(c.a, L).buffer }), new OctetString({ valueHex: bigIntToBytes(c.b, L).buffer })] }),
        new OctetString({ valueHex: new Uint8Array([4, ...bigIntToBytes(c.Gx, L), ...bigIntToBytes(c.Gy, L)]).buffer }),
        int(c.n),
        new Integer({ value: 1 }),
      ],
    });
    const spki = new Sequence({
      value: [new Sequence({ value: [new ObjectIdentifier({ value: "1.2.840.10045.2.1" }), ecParameters] }), new BitString({ valueHex: point.slice().buffer })],
    });
    const spkiDer = new Uint8Array(spki.toBER(false));
    // OpenSSL relit bien cette SPKI explicite comme la même clé.
    expect(createPublicKey({ key: Buffer.from(spkiDer), format: "der", type: "spki" }).asymmetricKeyType).toBe("ec");
    const signature = new Uint8Array(sign("sha256", data, privateKey));
    expect(verifySignaturePure({ spkiDer, scheme: { kind: "ECDSA", hash: "SHA-256" }, signature, signedData: data })).toBe(true);
    expect(verifySignaturePure({ spkiDer, scheme: { kind: "ECDSA", hash: "SHA-256" }, signature, signedData: tamper(data) })).toBe(false);
  });

  it("refuse une clé RSA avec un schéma ECDSA", () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() => verifySignaturePure({ spkiDer: spkiOf(publicKey), scheme: { kind: "ECDSA", hash: "SHA-256" }, signature: new Uint8Array(64), signedData: data })).toThrow();
  });
});
