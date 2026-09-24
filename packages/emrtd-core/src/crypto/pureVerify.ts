import { fromBER, BitString, Integer, ObjectIdentifier, OctetString, Sequence } from "asn1js";
import { sha1 } from "@noble/hashes/legacy";
import { sha224, sha256, sha384, sha512 } from "@noble/hashes/sha2";
import { weierstrassN, type WeierstrassPoint, type WeierstrassPointCons } from "@noble/curves/abstract/weierstrass";
import { bytesToBigInt, bigIntToBytes, standardizedEcDomain } from "./ecCurves";

/**
 * Vérification de signature RSA (PKCS#1 v1.5, PSS) et ECDSA en JavaScript pur (BigInt +
 * @noble/curves/@noble/hashes) — sans Web Crypto, absent de React Native/Hermes, et sans OpenSSL.
 * Couvre ce que les PKI eMRTD utilisent réellement : courbes NIST et Brainpool nommées, courbes à
 * paramètres explicites (RFC 3279 §2.3.5, fréquentes chez les CSCA européennes), signatures ECDSA
 * DER (X.509/CMS) ou "plain" r||s (BSI TR-03111). Vérifié contre node:crypto dans pureVerify.test.ts.
 */

export type HashName = "SHA-1" | "SHA-224" | "SHA-256" | "SHA-384" | "SHA-512";

const HASHES: Record<HashName, { fn: (data: Uint8Array) => Uint8Array; length: number }> = {
  "SHA-1": { fn: (d) => sha1(d), length: 20 },
  "SHA-224": { fn: (d) => sha224(d), length: 28 },
  "SHA-256": { fn: (d) => sha256(d), length: 32 },
  "SHA-384": { fn: (d) => sha384(d), length: 48 },
  "SHA-512": { fn: (d) => sha512(d), length: 64 },
};

export function hashBytes(hash: string, data: Uint8Array): Uint8Array {
  const entry = HASHES[hash as HashName];
  if (!entry) throw new Error(`Algorithme de hachage non supporté : ${hash}`);
  return entry.fn(data);
}

const RSA_KEY_OIDS = new Set(["1.2.840.113549.1.1.1", "1.2.840.113549.1.1.10"]);
const EC_KEY_OID = "1.2.840.10045.2.1";
const PRIME_FIELD_OID = "1.2.840.10045.1.1";

/** OID de courbe nommée → identifiant de paramètres standardisés (ecCurves.ts). */
const NAMED_CURVE_OIDS: Record<string, number> = {
  "1.2.840.10045.3.1.1": 8, // P-192
  "1.3.36.3.3.2.8.1.1.3": 9, // brainpoolP192r1
  "1.3.132.0.33": 10, // P-224
  "1.3.36.3.3.2.8.1.1.5": 11, // brainpoolP224r1
  "1.2.840.10045.3.1.7": 12, // P-256
  "1.3.36.3.3.2.8.1.1.7": 13, // brainpoolP256r1
  "1.3.36.3.3.2.8.1.1.9": 14, // brainpoolP320r1
  "1.3.132.0.34": 15, // P-384
  "1.3.36.3.3.2.8.1.1.11": 16, // brainpoolP384r1
  "1.3.36.3.3.2.8.1.1.13": 17, // brainpoolP512r1
  "1.3.132.0.35": 18, // P-521
};

type EcPublicKey = { kind: "EC"; Point: WeierstrassPointCons<bigint>; order: bigint; Q: WeierstrassPoint<bigint> };
type RsaPublicKey = { kind: "RSA"; n: bigint; e: bigint };
type ParsedPublicKey = RsaPublicKey | EcPublicKey;

function parseDer(bytes: Uint8Array, what: string) {
  const asn1 = fromBER(bytes.slice().buffer);
  if (asn1.offset === -1) throw new Error(`${what} : échec du décodage ASN.1`);
  return asn1.result;
}

function integerValue(node: unknown): bigint {
  if (!(node instanceof Integer)) throw new Error("INTEGER ASN.1 attendu");
  return bytesToBigInt(new Uint8Array(node.valueBlock.valueHexView));
}

function explicitCurve(params: Sequence): { Point: WeierstrassPointCons<bigint>; order: bigint } {
  // ECParameters ::= SEQUENCE { version, fieldID SEQUENCE { fieldType, prime }, curve SEQUENCE { a, b, seed? }, base, order, cofactor? }
  const [, fieldId, curve, base, orderNode, cofactorNode] = params.valueBlock.value;
  if (!(fieldId instanceof Sequence) || !(curve instanceof Sequence) || !(base instanceof OctetString)) {
    throw new Error("Paramètres EC explicites mal formés");
  }
  const fieldType = fieldId.valueBlock.value[0];
  if (!(fieldType instanceof ObjectIdentifier) || fieldType.valueBlock.toString() !== PRIME_FIELD_OID) {
    throw new Error("Paramètres EC explicites : seul le corps premier (prime-field) est pris en charge");
  }
  const p = integerValue(fieldId.valueBlock.value[1]);
  const [aNode, bNode] = curve.valueBlock.value;
  if (!(aNode instanceof OctetString) || !(bNode instanceof OctetString)) throw new Error("Paramètres EC explicites : a/b mal formés");
  const g = new Uint8Array(base.valueBlock.valueHexView);
  const fieldLength = Math.ceil(p.toString(16).length / 2);
  if (g[0] !== 0x04 || g.length !== 1 + 2 * fieldLength) throw new Error("Paramètres EC explicites : point de base non compressé attendu");
  const n = integerValue(orderNode);
  const Point = weierstrassN({
    p,
    a: bytesToBigInt(new Uint8Array(aNode.valueBlock.valueHexView)),
    b: bytesToBigInt(new Uint8Array(bNode.valueBlock.valueHexView)),
    n,
    h: cofactorNode instanceof Integer ? integerValue(cofactorNode) : 1n,
    Gx: bytesToBigInt(g.subarray(1, 1 + fieldLength)),
    Gy: bytesToBigInt(g.subarray(1 + fieldLength)),
  });
  return { Point, order: n };
}

export function parseSubjectPublicKeyInfo(spkiDer: Uint8Array): ParsedPublicKey {
  const spki = parseDer(spkiDer, "SubjectPublicKeyInfo");
  if (!(spki instanceof Sequence)) throw new Error("SubjectPublicKeyInfo : SEQUENCE attendue");
  const [algorithm, subjectPublicKey] = spki.valueBlock.value;
  if (!(algorithm instanceof Sequence) || !(subjectPublicKey instanceof BitString)) {
    throw new Error("SubjectPublicKeyInfo mal formée");
  }
  const [oidNode, params] = algorithm.valueBlock.value;
  const keyOid = (oidNode as ObjectIdentifier).valueBlock.toString();
  const keyBytes = new Uint8Array(subjectPublicKey.valueBlock.valueHexView);

  if (RSA_KEY_OIDS.has(keyOid)) {
    const rsaKey = parseDer(keyBytes, "RSAPublicKey");
    if (!(rsaKey instanceof Sequence)) throw new Error("RSAPublicKey : SEQUENCE attendue");
    const [nNode, eNode] = rsaKey.valueBlock.value;
    return { kind: "RSA", n: integerValue(nNode), e: integerValue(eNode) };
  }

  if (keyOid === EC_KEY_OID) {
    let Point: WeierstrassPointCons<bigint>;
    let order: bigint;
    if (params instanceof ObjectIdentifier) {
      const curveOid = params.valueBlock.toString();
      const parameterId = NAMED_CURVE_OIDS[curveOid];
      const domain = parameterId !== undefined ? standardizedEcDomain(parameterId) : undefined;
      if (!domain) throw new Error(`Courbe elliptique non prise en charge : OID ${curveOid}`);
      Point = domain.Point;
      order = domain.order;
    } else if (params instanceof Sequence) {
      ({ Point, order } = explicitCurve(params));
    } else {
      throw new Error("Clé EC sans paramètres de courbe exploitables");
    }
    const Q = Point.fromBytes(keyBytes);
    Q.assertValidity();
    return { kind: "EC", Point, order, Q };
  }

  throw new Error(`Type de clé publique non pris en charge : OID ${keyOid}`);
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

function modInverse(a: bigint, m: bigint): bigint {
  let [oldR, r] = [((a % m) + m) % m, m];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  if (oldR !== 1n) throw new Error("Inverse modulaire inexistant");
  return ((oldS % m) + m) % m;
}

function bitLength(n: bigint): number {
  return n.toString(2).length;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// DigestInfo DER (RFC 8017 §9.2 note 1), avec et sans le NULL des paramètres (les deux se rencontrent).
const DIGEST_INFO_PREFIXES: Record<HashName, string[]> = {
  "SHA-1": ["3021300906052b0e03021a05000414", "301f300706052b0e03021a0414"],
  "SHA-224": ["302d300d06096086480165030402040500041c", "302b300b0609608648016503040204041c"],
  "SHA-256": ["3031300d060960864801650304020105000420", "302f300b06096086480165030402010420"],
  "SHA-384": ["3041300d060960864801650304020205000430", "303f300b06096086480165030402020430"],
  "SHA-512": ["3051300d060960864801650304020305000440", "304f300b06096086480165030402030440"],
};

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

function rsaEncodedMessage(key: RsaPublicKey, signature: Uint8Array): Uint8Array | undefined {
  const k = Math.ceil(bitLength(key.n) / 8);
  if (signature.length !== k) return undefined;
  const s = bytesToBigInt(signature);
  if (s >= key.n) return undefined;
  return bigIntToBytes(modPow(s, key.e, key.n), k);
}

function verifyRsaPkcs1(key: RsaPublicKey, hash: HashName, signature: Uint8Array, data: Uint8Array): boolean {
  const em = rsaEncodedMessage(key, signature);
  if (!em) return false;
  const digest = hashBytes(hash, data);
  // RFC 8017 §8.2.2 : on reconstruit EM attendu (00 01 FF…FF 00 DigestInfo) et on compare en entier
  // — jamais d'analyse de l'ASN.1 déchiffré, source classique de falsifications (Bleichenbacher 2006).
  return DIGEST_INFO_PREFIXES[hash].some((prefixHex) => {
    const t = new Uint8Array([...hexToBytes(prefixHex), ...digest]);
    if (em.length < t.length + 11) return false;
    const expected = new Uint8Array(em.length);
    expected[1] = 0x01;
    expected.fill(0xff, 2, em.length - t.length - 1);
    expected.set(t, em.length - t.length);
    return equalBytes(em, expected);
  });
}

function mgf1(hash: HashName, seed: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  const hLen = HASHES[hash].length;
  for (let counter = 0, offset = 0; offset < length; counter++, offset += hLen) {
    const c = Uint8Array.of((counter >>> 24) & 0xff, (counter >>> 16) & 0xff, (counter >>> 8) & 0xff, counter & 0xff);
    const block = hashBytes(hash, new Uint8Array([...seed, ...c]));
    out.set(block.subarray(0, Math.min(hLen, length - offset)), offset);
  }
  return out;
}

function verifyRsaPss(key: RsaPublicKey, hash: HashName, saltLength: number, signature: Uint8Array, data: Uint8Array): boolean {
  const k = Math.ceil(bitLength(key.n) / 8);
  const decoded = rsaEncodedMessage(key, signature);
  if (!decoded) return false;
  // RFC 8017 §9.1.2 (EMSA-PSS-VERIFY), emBits = modBits − 1.
  const emBits = bitLength(key.n) - 1;
  const emLen = Math.ceil(emBits / 8);
  if (k > emLen && decoded[0] !== 0) return false;
  const em = decoded.subarray(k - emLen);
  const hLen = HASHES[hash].length;
  if (emLen < hLen + saltLength + 2 || em[emLen - 1] !== 0xbc) return false;
  const maskedDb = em.subarray(0, emLen - hLen - 1);
  const h = em.subarray(emLen - hLen - 1, emLen - 1);
  const zeroBits = 8 * emLen - emBits;
  if (zeroBits > 0 && maskedDb[0] >> (8 - zeroBits) !== 0) return false;
  const dbMask = mgf1(hash, h, maskedDb.length);
  const db = maskedDb.map((byte, i) => byte ^ dbMask[i]);
  if (zeroBits > 0) db[0] &= 0xff >> zeroBits;
  const psLength = emLen - hLen - saltLength - 2;
  for (let i = 0; i < psLength; i++) if (db[i] !== 0) return false;
  if (db[psLength] !== 0x01) return false;
  const salt = db.subarray(db.length - saltLength);
  const mPrime = new Uint8Array([...new Uint8Array(8), ...hashBytes(hash, data), ...salt]);
  return equalBytes(hashBytes(hash, mPrime), h);
}

/** Signature ECDSA DER (SEQUENCE { r, s }) ou "plain" r||s (BSI TR-03111). */
function ecdsaSignatureComponents(signature: Uint8Array): { r: bigint; s: bigint } | undefined {
  if (signature[0] === 0x30) {
    try {
      const seq = parseDer(signature, "Signature ECDSA");
      if (seq instanceof Sequence && seq.valueBlock.value.length === 2) {
        return { r: integerValue(seq.valueBlock.value[0]), s: integerValue(seq.valueBlock.value[1]) };
      }
    } catch {
      // pas du DER : on retente en plain ci-dessous
    }
  }
  if (signature.length === 0 || signature.length % 2 !== 0) return undefined;
  const half = signature.length / 2;
  return { r: bytesToBigInt(signature.subarray(0, half)), s: bytesToBigInt(signature.subarray(half)) };
}

function verifyEcdsa(key: EcPublicKey, hash: HashName, signature: Uint8Array, data: Uint8Array): boolean {
  const components = ecdsaSignatureComponents(signature);
  if (!components) return false;
  const { r, s } = components;
  const n = key.order;
  if (r <= 0n || r >= n || s <= 0n || s >= n) return false;
  // SEC 1 §4.1.4 : e = les bitlen(n) bits de poids fort du condensat.
  const digest = hashBytes(hash, data);
  let e = bytesToBigInt(digest);
  const excessBits = digest.length * 8 - bitLength(n);
  if (excessBits > 0) e >>= BigInt(excessBits);
  const w = modInverse(s, n);
  const u1 = (e * w) % n;
  const u2 = (r * w) % n;
  const X = key.Point.BASE.multiplyUnsafe(u1).add(key.Q.multiplyUnsafe(u2));
  if (X.equals(key.Point.ZERO)) return false;
  return X.toAffine().x % n === r;
}

export type PureSignatureScheme =
  | { kind: "RSASSA-PKCS1-v1_5"; hash: string }
  | { kind: "RSA-PSS"; hash: string; saltLength: number }
  | { kind: "ECDSA"; hash: string };

export function verifySignaturePure(params: {
  spkiDer: Uint8Array;
  scheme: PureSignatureScheme;
  signature: Uint8Array;
  signedData: Uint8Array;
}): boolean {
  const key = parseSubjectPublicKeyInfo(params.spkiDer);
  const hash = params.scheme.hash as HashName;
  if (!HASHES[hash]) throw new Error(`Algorithme de hachage non supporté : ${params.scheme.hash}`);
  switch (params.scheme.kind) {
    case "RSASSA-PKCS1-v1_5":
      if (key.kind !== "RSA") throw new Error("Incohérence : algorithme RSA avec une clé non RSA");
      return verifyRsaPkcs1(key, hash, params.signature, params.signedData);
    case "RSA-PSS":
      if (key.kind !== "RSA") throw new Error("Incohérence : algorithme RSA-PSS avec une clé non RSA");
      return verifyRsaPss(key, hash, params.scheme.saltLength, params.signature, params.signedData);
    case "ECDSA":
      if (key.kind !== "EC") throw new Error("Incohérence : clé RSA avec un algorithme de signature ECDSA");
      return verifyEcdsa(key, hash, params.signature, params.signedData);
  }
}
