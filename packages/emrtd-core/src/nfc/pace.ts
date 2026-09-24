import { fromBER, Integer, ObjectIdentifier, Sequence, Set as Asn1Set } from "asn1js";
import { buildCommandApdu, formatStatusWord, isSuccess, parseResponseApdu } from "./apdu";
import type { ApduTransceiver } from "./bac";
import type { SecureMessagingKeys } from "./secureMessaging";
import { aesCbcDecrypt, aesCmac8, aesEcbEncryptBlock } from "../crypto/aes";
import { tripleDesCbcDecrypt } from "../crypto/tripleDes";
import { computeRetailMac, constantTimeEquals, padIso9797Method2, unpadIso9797Method2 } from "../crypto/retailMac";
import { sha1 } from "../crypto/sha1";
import { sha256 } from "../crypto/sha256";
import { bigIntToBytes, bytesToBigInt, decodePoint, encodePoint, standardizedEcDomain, type EcDomain, type EcPoint } from "../crypto/ecCurves";
import { buildMrzInformation, type BacAccessKeyInput } from "../mrz/bacKey";

/**
 * PACE — Password Authenticated Connection Establishment (Doc 9303 Part 11 §4.4 et §9.2, BSI
 * TR-03110-2 §3.2 / TR-03110-3). Remplace BAC sur les documents récents : obligatoire en Europe
 * (règlement (UE) 2019/1157) et SEUL protocole accepté par de nombreuses cartes d'identité
 * (CNI françaises depuis 2021, cartes allemandes…). Les passeports le proposent en plus de BAC.
 *
 * Pris en charge : mappage générique ECDH (GM) et Chip Authentication Mapping (CAM : même canal que
 * GM, plus les données de Chip Authentication de la puce, déchiffrées ici et vérifiées contre DG14
 * par `verifyPaceCam`, chipAuthentication.ts), 3DES et AES
 * 128/192/256, les 11 courbes standardisées (ids 8–18). Non pris en charge (repli sur BAC par
 * l'appelant) : groupes MODP (DH), mappage intégré (IM), paramètres propriétaires.
 *
 * Validé octet par octet contre l'exemple travaillé officiel ICAO (Doc 9303 Part 11 Appendix G.1)
 * et deux traces réelles (passeport NZ en 3DES, carte DE en CAM AES) — voir pace.test.ts.
 */

/** Échec du protocole PACE (dialogue avec la puce, variante non prise en charge…). */
export class PaceError extends Error {}

/**
 * Échec de l'authentification mutuelle : mot de passe (MRZ/CAN) incorrect ou document non
 * authentique — même conduite que `BacAuthenticationError` côté UI (rescanner la MRZ).
 */
export class PaceAuthenticationError extends PaceError {}

/** Mot de passe PACE : clé MRZ (même triplet que BAC) ou CAN à 6 chiffres imprimé au recto. */
export type PacePassword = { kind: "mrz"; accessKey: BacAccessKeyInput } | { kind: "can"; can: string };

export interface PaceInfo {
  oid: string;
  version: number;
  parameterId: number | undefined;
  mapping: "GM" | "IM" | "CAM";
  agreement: "DH" | "ECDH";
  cipher: "3DES" | "AES";
  keyLength: 16 | 24 | 32;
}

export interface PaceResult {
  smKeys: SecureMessagingKeys;
  /** SSC initial après PACE : zéro (8 octets en 3DES, 16 en AES). */
  ssc: Uint8Array;
  paceInfo: PaceInfo;
  /** PACE-CAM uniquement : CA_IC déchiffré et clé publique de mappage de la puce. */
  cam?: { chipAuthenticationData: Uint8Array; chipMappingPublicKey: Uint8Array };
}

const PACE_OID_PREFIX = "0.4.0.127.0.7.2.2.4.";
const MAPPINGS: Record<string, { agreement: PaceInfo["agreement"]; mapping: PaceInfo["mapping"] }> = {
  "1": { agreement: "DH", mapping: "GM" },
  "2": { agreement: "ECDH", mapping: "GM" },
  "3": { agreement: "DH", mapping: "IM" },
  "4": { agreement: "ECDH", mapping: "IM" },
  "6": { agreement: "ECDH", mapping: "CAM" },
};
const CIPHERS: Record<string, { cipher: PaceInfo["cipher"]; keyLength: PaceInfo["keyLength"] }> = {
  "1": { cipher: "3DES", keyLength: 16 },
  "2": { cipher: "AES", keyLength: 16 },
  "3": { cipher: "AES", keyLength: 24 },
  "4": { cipher: "AES", keyLength: 32 },
};

/**
 * Extrait les PACEInfo d'EF.CardAccess (SecurityInfos ::= SET OF SecurityInfo, Doc 9303 Part 11
 * §9.2). Les autres SecurityInfo (Chip Authentication, paramètres de domaine…) sont ignorées.
 */
export function parsePaceInfos(cardAccess: Uint8Array): PaceInfo[] {
  const asn1 = fromBER(cardAccess.slice().buffer);
  if (asn1.offset === -1 || !(asn1.result instanceof Asn1Set)) {
    throw new PaceError("EF.CardAccess illisible (SET OF SecurityInfo attendu)");
  }
  const infos: PaceInfo[] = [];
  for (const item of asn1.result.valueBlock.value) {
    if (!(item instanceof Sequence)) continue;
    const [oidNode, versionNode, parameterNode] = item.valueBlock.value;
    if (!(oidNode instanceof ObjectIdentifier)) continue;
    const oid = oidNode.valueBlock.toString();
    if (!oid.startsWith(PACE_OID_PREFIX)) continue;
    const [mappingId, cipherId] = oid.slice(PACE_OID_PREFIX.length).split(".");
    const mapping = MAPPINGS[mappingId];
    const cipher = CIPHERS[cipherId];
    if (!mapping || !cipher || !(versionNode instanceof Integer)) continue; // PACEDomainParameterInfo & co.
    infos.push({
      oid,
      version: versionNode.valueBlock.valueDec,
      parameterId: parameterNode instanceof Integer ? parameterNode.valueBlock.valueDec : undefined,
      ...mapping,
      ...cipher,
    });
  }
  return infos;
}

/** PACEInfo que cette implémentation sait exécuter, GM préféré à CAM (plus simple, même sécurité du canal). */
export function selectSupportedPaceInfo(infos: PaceInfo[]): PaceInfo | undefined {
  const supported = infos.filter(
    (info) => info.agreement === "ECDH" && info.mapping !== "IM" && info.parameterId !== undefined && standardizedEcDomain(info.parameterId),
  );
  return supported.find((info) => info.mapping === "GM") ?? supported[0];
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function encodeLength(length: number): Uint8Array {
  if (length < 0x80) return Uint8Array.of(length);
  if (length <= 0xff) return Uint8Array.of(0x81, length);
  return Uint8Array.of(0x82, (length >> 8) & 0xff, length & 0xff);
}

export function tlv(tag: number, value: Uint8Array): Uint8Array {
  const tagBytes = tag > 0xff ? Uint8Array.of(tag >> 8, tag & 0xff) : Uint8Array.of(tag);
  return concatBytes(tagBytes, encodeLength(value.length), value);
}

/** Contenu DER d'un OID (sans tag ni longueur), tel qu'attendu dans MSE:Set AT (80) et le jeton (06). */
export function encodeOidContent(oid: string): Uint8Array {
  const arcs = oid.split(".").map(Number);
  const bytes: number[] = [arcs[0] * 40 + arcs[1]];
  for (const arc of arcs.slice(2)) {
    const chunk: number[] = [arc & 0x7f];
    for (let v = arc >>> 7; v > 0; v >>>= 7) chunk.unshift((v & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return Uint8Array.from(bytes);
}

/** Lit un TLV simple (tag sur 1 ou 2 octets, longueur définie) — suffisant pour les réponses GENERAL AUTHENTICATE. */
function readTlv(bytes: Uint8Array, offset: number): { tag: number; value: Uint8Array; next: number } {
  if (offset + 2 > bytes.length) throw new PaceError("Réponse de la puce tronquée");
  let pos = offset;
  let tag = bytes[pos++];
  if ((tag & 0x1f) === 0x1f) tag = (tag << 8) | bytes[pos++];
  let length = bytes[pos++];
  if (length === 0x81) length = bytes[pos++];
  else if (length === 0x82) {
    length = (bytes[pos] << 8) | bytes[pos + 1];
    pos += 2;
  } else if (length >= 0x80) {
    throw new PaceError("Longueur TLV non prise en charge dans la réponse de la puce");
  }
  const value = bytes.subarray(pos, pos + length);
  if (value.length !== length) throw new PaceError("Réponse de la puce tronquée");
  return { tag, value, next: pos + length };
}

function dynamicAuthData(response: Uint8Array): Map<number, Uint8Array> {
  const outer = readTlv(response, 0);
  if (outer.tag !== 0x7c) throw new PaceError("Réponse GENERAL AUTHENTICATE sans modèle 7C");
  const objects = new Map<number, Uint8Array>();
  for (let offset = 0; offset < outer.value.length; ) {
    const inner = readTlv(outer.value, offset);
    objects.set(inner.tag, inner.value);
    offset = inner.next;
  }
  return objects;
}

/** KDF (Doc 9303 Part 11 §9.7.1) : SHA-1 pour 3DES/AES-128, SHA-256 au-delà ; parité DES ajustée en 3DES. */
export function derivePaceKey(secret: Uint8Array, counter: 1 | 2 | 3, info: Pick<PaceInfo, "cipher" | "keyLength">): Uint8Array {
  const input = concatBytes(secret, Uint8Array.of(0, 0, 0, counter));
  const digest = info.keyLength === 16 ? sha1(input) : sha256(input);
  const key = digest.slice(0, info.keyLength);
  if (info.cipher === "3DES") {
    for (let i = 0; i < key.length; i++) {
      let ones = 0;
      for (let v = key[i] >> 1; v; v >>= 1) ones += v & 1;
      key[i] = (key[i] & 0xfe) | (ones % 2 === 0 ? 1 : 0);
    }
  }
  return key;
}

function passwordSecret(password: PacePassword): Uint8Array {
  if (password.kind === "can") {
    if (!/^\d{6}$/.test(password.can)) throw new PaceError("Le CAN doit comporter 6 chiffres");
    return new TextEncoder().encode(password.can);
  }
  return sha1(new TextEncoder().encode(buildMrzInformation(password.accessKey)));
}

function paceMac(info: PaceInfo, key: Uint8Array, data: Uint8Array): Uint8Array {
  return info.cipher === "AES" ? aesCmac8(key, data) : computeRetailMac(key, padIso9797Method2(data));
}

export function randomScalar(order: bigint, byteLength: number): bigint {
  if (typeof globalThis.crypto?.getRandomValues === "undefined") {
    throw new Error("crypto.getRandomValues indisponible : importer `react-native-get-random-values` avant toute lecture NFC.");
  }
  const bytes = new Uint8Array(byteLength + 8); // 64 bits de marge : biais modulo négligeable
  globalThis.crypto.getRandomValues(bytes);
  return (bytesToBigInt(bytes) % (order - 1n)) + 1n;
}

export interface PaceOptions {
  /** Injection des clés éphémères (tests uniquement) : appelée pour la clé de mappage puis pour la clé d'accord. */
  generatePrivateKey?: (domain: EcDomain, step: "mapping" | "agreement") => bigint;
}

async function exchange(transceiver: ApduTransceiver, apdu: Uint8Array, step: string, ErrorClass: typeof PaceError = PaceError) {
  const response = parseResponseApdu(await transceiver.transceive(apdu));
  if (!isSuccess(response)) {
    throw new ErrorClass(`${step} a échoué : SW=${formatStatusWord(response)}`);
  }
  return response.data;
}

function generalAuthenticate(data: Uint8Array, last: boolean): Uint8Array {
  return buildCommandApdu({ cla: last ? 0x00 : 0x10, ins: 0x86, p1: 0x00, p2: 0x00, data: tlv(0x7c, data), le: 0 });
}

/**
 * Exécute PACE (EF.CardAccess déjà lu, voir `parsePaceInfos`). Renvoie les clés de messagerie
 * sécurisée et le SSC initial (nul) — à passer tels quels à `readEmrtdChipData`, qui sélectionne
 * ensuite l'application eMRTD sous messagerie sécurisée, comme l'exige Doc 9303 après PACE.
 */
export async function performPace(
  transceiver: ApduTransceiver,
  password: PacePassword,
  info: PaceInfo,
  options: PaceOptions = {},
): Promise<PaceResult> {
  const domain = info.parameterId !== undefined ? standardizedEcDomain(info.parameterId) : undefined;
  if (info.agreement !== "ECDH" || info.mapping === "IM" || !domain) {
    throw new PaceError(`Variante PACE non prise en charge : ${info.oid} (paramètres ${info.parameterId ?? "absents"})`);
  }
  const newKey = (step: "mapping" | "agreement") =>
    options.generatePrivateKey?.(domain, step) ?? randomScalar(domain.order, domain.fieldLength);
  const oidContent = encodeOidContent(info.oid);

  // 1. MSE:Set AT — protocole, mot de passe (01 = MRZ, 02 = CAN), paramètres de domaine.
  const setAt = concatBytes(
    tlv(0x80, oidContent),
    tlv(0x83, Uint8Array.of(password.kind === "mrz" ? 0x01 : 0x02)),
    tlv(0x84, Uint8Array.of(domain.parameterId)),
  );
  await exchange(transceiver, buildCommandApdu({ cla: 0x00, ins: 0x22, p1: 0xc1, p2: 0xa4, data: setAt }), "MSE:Set AT");

  // 2. Nonce chiffré z → s = D(Kπ, z), IV nul.
  const kPi = derivePaceKey(passwordSecret(password), 3, info);
  const nonceObjects = dynamicAuthData(await exchange(transceiver, generalAuthenticate(new Uint8Array(0), false), "GENERAL AUTHENTICATE (nonce)"));
  const encryptedNonce = nonceObjects.get(0x80);
  if (!encryptedNonce) throw new PaceError("Nonce chiffré absent de la réponse de la puce");
  const nonce =
    info.cipher === "AES" ? aesCbcDecrypt(kPi, new Uint8Array(16), encryptedNonce) : tripleDesCbcDecrypt(kPi, new Uint8Array(8), encryptedNonce);

  // 3. Mappage générique : G' = s·G + H, avec H = SKmap,PCD · PKmap,PICC.
  const G = domain.Point.BASE;
  const mapPrivate = newKey("mapping");
  const mapPublic = G.multiply(mapPrivate);
  const mapObjects = dynamicAuthData(
    await exchange(transceiver, generalAuthenticate(tlv(0x81, encodePoint(domain, mapPublic)), false), "GENERAL AUTHENTICATE (mappage)"),
  );
  const chipMapPublic = decodePoint(domain, mapObjects.get(0x82) ?? new Uint8Array(0));
  if (chipMapPublic.equals(mapPublic)) throw new PaceError("Clé de mappage de la puce identique à la nôtre — refusée");
  const H = chipMapPublic.multiply(mapPrivate);
  const mappedG: EcPoint = G.multiply(bytesToBigInt(nonce) % domain.order).add(H);

  // 4. Accord de clé éphémère sur G', K = abscisse de SK_PCD · PK_PICC.
  const ephPrivate = newKey("agreement");
  const ephPublic = mappedG.multiply(ephPrivate);
  const agreementObjects = dynamicAuthData(
    await exchange(transceiver, generalAuthenticate(tlv(0x83, encodePoint(domain, ephPublic)), false), "GENERAL AUTHENTICATE (accord de clé)"),
  );
  const chipEphPublic = decodePoint(domain, agreementObjects.get(0x84) ?? new Uint8Array(0));
  if (chipEphPublic.equals(ephPublic) || chipEphPublic.equals(chipMapPublic)) {
    throw new PaceError("Clé éphémère de la puce invalide (réutilisée) — refusée");
  }
  const sharedSecret = bigIntToBytes(chipEphPublic.multiply(ephPrivate).toAffine().x, domain.fieldLength);
  const ksEnc = derivePaceKey(sharedSecret, 1, info);
  const ksMac = derivePaceKey(sharedSecret, 2, info);

  // 5. Authentification mutuelle : chaque partie authentifie la clé publique éphémère de l'autre.
  // Un mot de passe faux fait échouer cette étape (SW 63xx de la puce ou jeton incorrect).
  const publicKeyObject = (point: EcPoint) => tlv(0x7f49, concatBytes(tlv(0x06, oidContent), tlv(0x86, encodePoint(domain, point))));
  const terminalToken = paceMac(info, ksMac, publicKeyObject(chipEphPublic));
  const tokenObjects = dynamicAuthData(
    await exchange(transceiver, generalAuthenticate(tlv(0x85, terminalToken), true), "GENERAL AUTHENTICATE (authentification mutuelle)", PaceAuthenticationError),
  );
  const chipToken = tokenObjects.get(0x86);
  if (!chipToken || !constantTimeEquals(chipToken, paceMac(info, ksMac, publicKeyObject(ephPublic)))) {
    throw new PaceAuthenticationError("Jeton d'authentification de la puce invalide — document non authentique ou MRZ incorrecte");
  }

  // PACE-CAM : A_IC = E(KSenc, CA_IC), AES-CBC avec IV = E(KSenc, -1) (SSC tout à 1), padding
  // ISO 9797-1 méthode 2 (Doc 9303 Part 11 §4.4.3.5.1). CA_IC se vérifie une fois DG14 lu.
  let cam: PaceResult["cam"];
  const encryptedCam = tokenObjects.get(0x8a);
  if (info.mapping === "CAM" && encryptedCam && info.cipher === "AES") {
    try {
      const iv = aesEcbEncryptBlock(ksEnc, new Uint8Array(16).fill(0xff));
      cam = {
        chipAuthenticationData: unpadIso9797Method2(aesCbcDecrypt(ksEnc, iv, encryptedCam)),
        chipMappingPublicKey: encodePoint(domain, chipMapPublic),
      };
    } catch {
      cam = undefined; // Données illisibles : la Chip Authentication classique prendra le relais.
    }
  }

  return {
    smKeys: { ksEnc, ksMac, cipher: info.cipher },
    ssc: new Uint8Array(info.cipher === "AES" ? 16 : 8),
    paceInfo: info,
    cam,
  };
}
