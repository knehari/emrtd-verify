import { BitString, fromBER, Integer, ObjectIdentifier, Sequence, Set as Asn1Set } from "asn1js";
import type { CommandApduInput } from "./apdu";
import type { SecureMessagingKeys } from "./secureMessaging";
import { derivePaceKey, encodeOidContent, randomScalar, tlv } from "./pace";
import { parseSubjectPublicKeyInfo, type EcPublicKey } from "../crypto/pureVerify";
import { bigIntToBytes, bytesToBigInt } from "../crypto/ecCurves";

/**
 * Chip Authentication (Doc 9303 Part 11 §6.2, BSI TR-03110-1 §4.2) — preuve anti-clonage des
 * documents qui publient dans DG14 une clé publique de la puce (la plupart des passeports et cartes
 * émis depuis ~2010, CNI françaises, cartes allemandes…) : le terminal fait un accord de clé
 * Diffie-Hellman éphémère-statique avec cette clé, et la messagerie sécurisée repart sur les clés
 * qui en dérivent. Seule une puce qui détient la clé privée correspondante (jamais lisible, donc
 * absente d'une copie des données) peut ensuite répondre correctement. DG14 étant couvert par le
 * SOD, la clé utilisée est elle-même garantie par l'authentification passive.
 *
 * Pris en charge : CA version 1 en ECDH (courbes nommées, explicites ou standardisées 8 à 18) et en
 * DH (paramètres X9.42 ou PKCS #3), avec 3DES (MSE:Set KAT) ou AES 128/192/256 (MSE:Set AT +
 * GENERAL AUTHENTICATE), comme l'exige Doc 9303 Part 11 §6.2.4. Et la vérification des données de
 * PACE-CAM (§4.4.3.5), qui apporte la même preuve pendant PACE.
 */

const ID_CA = "0.4.0.127.0.7.2.2.3";
const ID_PK_DH = "0.4.0.127.0.7.2.2.1.1";
const ID_PK_ECDH = "0.4.0.127.0.7.2.2.1.2";
const DH_X942_OID = "1.2.840.10046.2.1";
const DH_PKCS3_OID = "1.2.840.113549.1.3.1";

export class ChipAuthenticationError extends Error {}

export type ChipAuthenticationAgreement = "DH" | "ECDH";

export interface ChipAuthenticationInfo {
  oid: string;
  agreement: ChipAuthenticationAgreement;
  cipher: "3DES" | "AES";
  keyLength: 16 | 24 | 32;
  version: number;
  keyId?: number;
}

export interface ChipAuthenticationPublicKeyInfo {
  agreement: ChipAuthenticationAgreement;
  spkiDer: Uint8Array;
  keyId?: number;
}

export interface Dg14ChipAuthentication {
  infos: ChipAuthenticationInfo[];
  publicKeys: ChipAuthenticationPublicKeyInfo[];
}

const CIPHERS: Record<string, { cipher: "3DES" | "AES"; keyLength: 16 | 24 | 32 }> = {
  "1": { cipher: "3DES", keyLength: 16 },
  "2": { cipher: "AES", keyLength: 16 },
  "3": { cipher: "AES", keyLength: 24 },
  "4": { cipher: "AES", keyLength: 32 },
};

function integerNumber(node: unknown): number | undefined {
  return node instanceof Integer ? Number(bytesToBigInt(new Uint8Array(node.valueBlock.valueHexView))) : undefined;
}

/**
 * SecurityInfos de DG14 (0x6E { SET OF SecurityInfo }) utiles à la Chip Authentication :
 * ChipAuthenticationInfo (id-CA-*) et ChipAuthenticationPublicKeyInfo (id-PK-DH / id-PK-ECDH).
 */
export function parseDg14ChipAuthentication(dg14: Uint8Array): Dg14ChipAuthentication {
  const outer = fromBER(dg14.slice().buffer);
  if (outer.offset === -1) throw new ChipAuthenticationError("DG14 illisible (ASN.1)");
  const set = (outer.result as unknown as { valueBlock: { value?: unknown[] } }).valueBlock?.value?.[0];
  if (!(set instanceof Asn1Set)) throw new ChipAuthenticationError("DG14 sans ensemble SecurityInfos");

  const infos: ChipAuthenticationInfo[] = [];
  const publicKeys: ChipAuthenticationPublicKeyInfo[] = [];
  for (const entry of set.valueBlock.value) {
    if (!(entry instanceof Sequence)) continue;
    const [protocolNode, required, optional] = entry.valueBlock.value;
    if (!(protocolNode instanceof ObjectIdentifier)) continue;
    const oid = protocolNode.valueBlock.toString();

    if (oid.startsWith(`${ID_CA}.`)) {
      const [agreementId, cipherId] = oid.slice(ID_CA.length + 1).split(".");
      const cipher = CIPHERS[cipherId];
      const version = integerNumber(required);
      if (!cipher || version === undefined || (agreementId !== "1" && agreementId !== "2")) continue;
      infos.push({ oid, agreement: agreementId === "1" ? "DH" : "ECDH", ...cipher, version, keyId: integerNumber(optional) });
    } else if ((oid === ID_PK_DH || oid === ID_PK_ECDH) && required instanceof Sequence) {
      publicKeys.push({
        agreement: oid === ID_PK_DH ? "DH" : "ECDH",
        spkiDer: new Uint8Array(required.toBER(false)),
        keyId: integerNumber(optional),
      });
    }
  }
  return { infos, publicKeys };
}

type DhKey = { kind: "DH"; p: bigint; g: bigint; q?: bigint; y: bigint };
export type ChipAuthenticationKey = DhKey | EcPublicKey;

function bitLength(n: bigint): number {
  return n.toString(2).length;
}

function byteLength(n: bigint): number {
  return Math.ceil(bitLength(n) / 8);
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  for (let e = exponent; e > 0n; e >>= 1n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
  }
  return result;
}

function parseDhPublicKey(spkiDer: Uint8Array): DhKey {
  const spki = fromBER(spkiDer.slice().buffer).result;
  if (!(spki instanceof Sequence)) throw new ChipAuthenticationError("Clé DH de DG14 mal formée");
  const [algorithm, subjectPublicKey] = spki.valueBlock.value;
  if (!(algorithm instanceof Sequence) || !(subjectPublicKey instanceof BitString)) {
    throw new ChipAuthenticationError("Clé DH de DG14 mal formée");
  }
  const [oidNode, params] = algorithm.valueBlock.value;
  const oid = oidNode instanceof ObjectIdentifier ? oidNode.valueBlock.toString() : "";
  if ((oid !== DH_X942_OID && oid !== DH_PKCS3_OID) || !(params instanceof Sequence)) {
    throw new ChipAuthenticationError(`Paramètres DH non pris en charge (${oid || "absents"})`);
  }
  const values = params.valueBlock.value.map((node) =>
    node instanceof Integer ? bytesToBigInt(new Uint8Array(node.valueBlock.valueHexView)) : undefined,
  );
  const [p, g, third] = values;
  const yNode = fromBER(new Uint8Array(subjectPublicKey.valueBlock.valueHexView).slice().buffer).result;
  if (p === undefined || g === undefined || !(yNode instanceof Integer)) throw new ChipAuthenticationError("Clé DH de DG14 incomplète");
  const y = bytesToBigInt(new Uint8Array(yNode.valueBlock.valueHexView));
  // X9.42 : SEQUENCE { p, g, q, … } ; PKCS #3 : SEQUENCE { p, g, privateValueLength? }.
  const q = oid === DH_X942_OID ? third : undefined;
  if (y <= 1n || y >= p - 1n || (q !== undefined && modPow(y, q, p) !== 1n)) {
    throw new ChipAuthenticationError("Clé publique DH de la puce invalide");
  }
  return { kind: "DH", p, g, q, y };
}

export function parseChipAuthenticationKey(info: ChipAuthenticationPublicKeyInfo): ChipAuthenticationKey {
  if (info.agreement === "DH") return parseDhPublicKey(info.spkiDer);
  const key = parseSubjectPublicKeyInfo(info.spkiDer);
  if (key.kind !== "EC") throw new ChipAuthenticationError("Clé ECDH de DG14 : clé EC attendue");
  return key;
}

export interface ChipAuthenticationSelection {
  info: ChipAuthenticationInfo;
  key: ChipAuthenticationKey;
  keyId?: number;
}

/**
 * Choisit le protocole et la clé à utiliser : un ChipAuthenticationInfo apparié à une clé du même
 * type (et du même keyId s'il y en a plusieurs), AES préféré à 3DES. Sans ChipAuthenticationInfo
 * (documents anciens), CA version 1 en 3DES est implicite (Doc 9303 Part 11 §6.2.2).
 */
export function selectChipAuthentication(dg14: Dg14ChipAuthentication): ChipAuthenticationSelection {
  if (dg14.publicKeys.length === 0) throw new ChipAuthenticationError("DG14 sans clé publique de Chip Authentication");
  const infos: ChipAuthenticationInfo[] =
    dg14.infos.length > 0
      ? [...dg14.infos].sort((a, b) => (a.cipher === b.cipher ? b.keyLength - a.keyLength : a.cipher === "AES" ? -1 : 1))
      : dg14.publicKeys.map((pk) => ({
          oid: `${ID_CA}.${pk.agreement === "DH" ? 1 : 2}.1`,
          agreement: pk.agreement,
          cipher: "3DES" as const,
          keyLength: 16 as const,
          version: 1,
          keyId: pk.keyId,
        }));
  const errors: string[] = [];
  for (const info of infos) {
    const candidates = dg14.publicKeys.filter(
      (pk) => pk.agreement === info.agreement && (info.keyId === undefined || pk.keyId === undefined || pk.keyId === info.keyId),
    );
    for (const pk of candidates) {
      try {
        return { info, key: parseChipAuthenticationKey(pk), keyId: info.keyId ?? pk.keyId };
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  throw new ChipAuthenticationError(`Aucune variante de Chip Authentication exploitable${errors.length ? ` : ${errors.join(" ; ")}` : ""}`);
}

export interface ChipAuthenticationExchange {
  /** Commandes à envoyer sous la messagerie sécurisée EN COURS, dans l'ordre. */
  commands: CommandApduInput[];
  /** Clés de messagerie sécurisée à adopter ensuite, avec un SSC remis à zéro. */
  keys: SecureMessagingKeys;
  ssc: Uint8Array;
}

function keyIdBytes(keyId: number): Uint8Array {
  const bytes = bigIntToBytes(BigInt(keyId), Math.max(1, byteLength(BigInt(keyId))));
  return bytes[0] & 0x80 ? Uint8Array.of(0, ...bytes) : bytes;
}

/**
 * Prépare l'échange : paire de clés éphémère sur les paramètres de la clé de la puce, secret
 * partagé (abscisse du point commun en ECDH, valeur commune sur |p| octets en DH), clés de session
 * dérivées comme pour PACE (Doc 9303 Part 11 §9.7.1).
 */
export function prepareChipAuthentication(
  selection: ChipAuthenticationSelection,
  generatePrivateKey?: (order: bigint) => bigint,
): ChipAuthenticationExchange {
  const { info, key, keyId } = selection;
  let ephemeralPublic: Uint8Array;
  let sharedSecret: Uint8Array;
  if (key.kind === "DH") {
    const length = byteLength(key.p);
    // Exposant de 256 bits sans q (PKCS #3) : sécurité ~128 bits, calcul raisonnable sur mobile.
    const bound = key.q ?? 1n << 256n;
    const x = generatePrivateKey?.(bound) ?? randomScalar(bound, byteLength(bound));
    ephemeralPublic = bigIntToBytes(modPow(key.g, x, key.p), length);
    sharedSecret = bigIntToBytes(modPow(key.y, x, key.p), length);
  } else {
    const fieldLength = byteLength(key.Point.CURVE().p);
    const d = generatePrivateKey?.(key.order) ?? randomScalar(key.order, fieldLength);
    const pub = key.Point.BASE.multiply(d).toAffine();
    ephemeralPublic = Uint8Array.of(0x04, ...bigIntToBytes(pub.x, fieldLength), ...bigIntToBytes(pub.y, fieldLength));
    sharedSecret = bigIntToBytes(key.Q.multiply(d).toAffine().x, fieldLength);
  }

  const keyReference = keyId !== undefined ? tlv(0x84, keyIdBytes(keyId)) : new Uint8Array(0);
  const commands: CommandApduInput[] =
    info.cipher === "3DES"
      ? [{ cla: 0x00, ins: 0x22, p1: 0x41, p2: 0xa6, data: Uint8Array.of(...tlv(0x91, ephemeralPublic), ...keyReference) }]
      : [
          { cla: 0x00, ins: 0x22, p1: 0x41, p2: 0xa4, data: Uint8Array.of(...tlv(0x80, encodeOidContent(info.oid)), ...keyReference) },
          { cla: 0x00, ins: 0x86, p1: 0x00, p2: 0x00, data: tlv(0x7c, tlv(0x80, ephemeralPublic)), le: 0 },
        ];

  return {
    commands,
    keys: {
      ksEnc: derivePaceKey(sharedSecret, 1, info),
      ksMac: derivePaceKey(sharedSecret, 2, info),
      cipher: info.cipher,
    },
    ssc: new Uint8Array(info.cipher === "AES" ? 16 : 8),
  };
}

/** Données de Chip Authentication renvoyées par la puce pendant PACE-CAM (voir pace.ts). */
export interface PaceCamData {
  /** CA_IC déchiffré (entier big-endian). */
  chipAuthenticationData: Uint8Array;
  /** Clé publique de mappage de la puce, point non compressé. */
  chipMappingPublicKey: Uint8Array;
}

/**
 * PACE-CAM (Doc 9303 Part 11 §4.4.3.5.2) : la puce prouve détenir la clé privée de Chip
 * Authentication si PK_map,IC = CA_IC · PK_IC, avec PK_IC la clé publique ECDH de DG14.
 */
export function verifyPaceCam(cam: PaceCamData, dg14: Dg14ChipAuthentication): { valid: boolean; reason?: string } {
  const ecKeys = dg14.publicKeys.filter((pk) => pk.agreement === "ECDH");
  if (ecKeys.length === 0) return { valid: false, reason: "DG14 sans clé ECDH : données PACE-CAM invérifiables" };
  const ca = bytesToBigInt(cam.chipAuthenticationData);
  for (const pk of ecKeys) {
    let key: ChipAuthenticationKey;
    try {
      key = parseChipAuthenticationKey(pk);
    } catch {
      continue;
    }
    if (key.kind !== "EC" || ca <= 0n || ca >= key.order) continue;
    const fieldLength = byteLength(key.Point.CURVE().p);
    const expected = key.Q.multiply(ca).toAffine();
    const encoded = Uint8Array.of(0x04, ...bigIntToBytes(expected.x, fieldLength), ...bigIntToBytes(expected.y, fieldLength));
    if (encoded.length === cam.chipMappingPublicKey.length && encoded.every((b, i) => b === cam.chipMappingPublicKey[i])) {
      return { valid: true };
    }
  }
  return { valid: false, reason: "PK_map,IC ≠ CA_IC · PK_IC pour les clés de DG14" };
}
