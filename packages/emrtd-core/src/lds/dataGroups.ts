import type { DataGroupNumber } from "@emrtd-verify/shared-types";

/** Doc 9303 Part 10 — un groupe de données tel que lu sur la puce, avant interprétation métier. */
export interface RawDataGroup {
  number: DataGroupNumber;
  /** Contenu TLV brut du DG, tel que lu sur la puce (non interprété). */
  bytes: Uint8Array;
}

export class DataGroupParseError extends Error {}

/** Longueur BER-TLV (forme définie uniquement) à `offset` — même règle que le DER (sous-ensemble du BER utilisé ici). */
function readBerLength(bytes: Uint8Array, offset: number): { length: number; headerLength: number } {
  if (offset >= bytes.length) {
    throw new DataGroupParseError("Fin de tampon inattendue en lisant une longueur BER-TLV");
  }
  const first = bytes[offset];
  if (first < 0x80) {
    return { length: first, headerLength: 1 };
  }
  const numLengthBytes = first & 0x7f;
  if (numLengthBytes < 1 || numLengthBytes > 4 || offset + 1 + numLengthBytes > bytes.length) {
    throw new DataGroupParseError(`Longueur BER-TLV non supportée ou tronquée (préfixe 0x${first.toString(16)})`);
  }
  let length = 0;
  for (let i = 0; i < numLengthBytes; i++) {
    length = (length << 8) | bytes[offset + 1 + i];
  }
  return { length, headerLength: 1 + numLengthBytes };
}

/**
 * Lit un TLV à 1 octet de tag (tag < 0x1F, forme non étendue) à `offset` — renvoie sa valeur et
 * l'offset juste après. N'accepte QUE le tag attendu : tout autre tag est une erreur explicite
 * plutôt qu'un octet mal interprété silencieusement.
 */
function readSingleByteTagTlv(bytes: Uint8Array, offset: number, expectedTag: number): { value: Uint8Array; nextOffset: number } {
  if (offset >= bytes.length || bytes[offset] !== expectedTag) {
    throw new DataGroupParseError(
      `Tag TLV inattendu à l'offset ${offset} : attendu 0x${expectedTag.toString(16)}, trouvé ${offset < bytes.length ? "0x" + bytes[offset].toString(16) : "(fin de tampon)"}`,
    );
  }
  const { length, headerLength } = readBerLength(bytes, offset + 1);
  const valueOffset = offset + 1 + headerLength;
  if (valueOffset + length > bytes.length) {
    throw new DataGroupParseError("Longueur TLV déclarée dépasse la taille du tampon");
  }
  return { value: bytes.slice(valueOffset, valueOffset + length), nextOffset: valueOffset + length };
}

/**
 * Lit un TLV à 2 octets de tag (forme étendue BER : premier octet se terminant par 0b11111,
 * second octet = numéro de tag, sans bit de continuation — suffisant pour tous les tags LDS
 * utilisés ici, tous < 0x80) à `offset`.
 */
function readTwoByteTagTlv(bytes: Uint8Array, offset: number, expectedTagByte1: number, expectedTagByte2: number): { value: Uint8Array; nextOffset: number } {
  if (offset + 1 >= bytes.length || bytes[offset] !== expectedTagByte1 || bytes[offset + 1] !== expectedTagByte2) {
    throw new DataGroupParseError(
      `Tag TLV inattendu à l'offset ${offset} : attendu 0x${expectedTagByte1.toString(16)}${expectedTagByte2.toString(16)}`,
    );
  }
  const { length, headerLength } = readBerLength(bytes, offset + 2);
  const valueOffset = offset + 2 + headerLength;
  if (valueOffset + length > bytes.length) {
    throw new DataGroupParseError("Longueur TLV déclarée dépasse la taille du tampon");
  }
  return { value: bytes.slice(valueOffset, valueOffset + length), nextOffset: valueOffset + length };
}

/** Bytes ASCII (7 bits) vers string, sans dépendre de TextDecoder (absent de Hermes/React Native sans polyfill) — garanti 7 bits pour une MRZ (Doc 9303 Part 3 §5), réutilisé ailleurs (lds/chipDataEnvelope.ts) pour tout contenu ASCII-safe (ex. JSON encodé en base64). */
export function asciiBytesToString(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) {
    result += String.fromCharCode(byte);
  }
  return result;
}

const DG1_TAG = 0x61;
const DG1_MRZ_TAG_BYTE1 = 0x5f;
const DG1_MRZ_TAG_BYTE2 = 0x1f;

/**
 * Extrait le texte MRZ brut (concaténation des lignes sans séparateur — 88 caractères pour TD3,
 * 90 pour TD1/TD2) depuis DG1 (Doc 9303 Part 10 §4.7.1) : SEQUENCE applicative 0x61 { tag 0x5F1F =
 * chaîne MRZ }. Les longueurs de ligne (44×2 ou 30×3) permettent de retrouver le format sans champ
 * dédié — voir `splitMrzTextIntoLines`.
 */
export function extractDg1MrzText(dg1: Uint8Array): string {
  const { value: outer } = readSingleByteTagTlv(dg1, 0, DG1_TAG);
  const { value: mrzBytes } = readTwoByteTagTlv(outer, 0, DG1_MRZ_TAG_BYTE1, DG1_MRZ_TAG_BYTE2);
  return asciiBytesToString(mrzBytes);
}

/** Découpe le texte MRZ concaténé de DG1 en lignes, selon sa longueur (88 → TD3, 90 → TD1/TD2 — Doc 9303 Part 3 §5). */
export function splitMrzTextIntoLines(mrzText: string): string[] {
  if (mrzText.length === 88) {
    return [mrzText.slice(0, 44), mrzText.slice(44, 88)];
  }
  if (mrzText.length === 90) {
    return [mrzText.slice(0, 30), mrzText.slice(30, 60), mrzText.slice(60, 90)];
  }
  throw new DataGroupParseError(`Longueur de texte MRZ inattendue dans DG1 : ${mrzText.length} caractères (attendu 88 ou 90)`);
}

const JPEG_SOI = Uint8Array.of(0xff, 0xd8, 0xff);
// Signature de boîte JP2 (ISO/IEC 15444-1 Annex I) : taille de boîte (4 octets) + "jP  " + 0x0D0A870A.
const JPEG2000_SIGNATURE = Uint8Array.of(0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a);

function indexOfSubsequence(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Extrait l'image du visage encapsulée dans DG2 (Doc 9303 Part 10 §6, structure CBEFF/ISO 19794-5
 * complète : Biometric Information Template imbriqués 0x7F61/0x7F60/0xA1/0x5F2E ou 0x7F2E). Cette
 * implémentation ne décode PAS cette structure CBEFF complète (aucun vecteur de test faisant
 * autorité disponible dans cet environnement pour la valider byte-exact, contrairement au reste de
 * ce module — voir la discipline "jamais d'implémentation à l'aveugle" documentée dans
 * docs/roadmap.md) : elle repère pragmatiquement le début des octets JPEG/JPEG2000 par leur
 * signature (marqueur SOI 0xFFD8FFxx, ou boîte de signature JP2) et prend tout le reste du DG2
 * comme image — correct tant que l'image biométrique est le dernier élément du gabarit (cas
 * general en pratique), mais PAS un décodeur CBEFF conforme (ex. plusieurs gabarits biométriques
 * ne seraient pas gérés correctement). Limite documentée, pas un oubli.
 */
export function extractDg2FaceImage(dg2: Uint8Array): { imageFormat: "JPEG" | "JPEG2000"; imageBytes: Uint8Array } {
  const jpegIndex = indexOfSubsequence(dg2, JPEG_SOI);
  const jp2Index = indexOfSubsequence(dg2, JPEG2000_SIGNATURE);

  // JP2 signature box precedes the actual image data by a few bytes of box header consumed by
  // the raw slice starting at the signature itself (decoders expect the box from its start).
  if (jp2Index !== -1 && (jpegIndex === -1 || jp2Index < jpegIndex)) {
    return { imageFormat: "JPEG2000", imageBytes: dg2.slice(jp2Index - 4 >= 0 ? jp2Index - 4 : jp2Index) };
  }
  if (jpegIndex !== -1) {
    return { imageFormat: "JPEG", imageBytes: dg2.slice(jpegIndex) };
  }
  throw new DataGroupParseError("Aucune image JPEG/JPEG2000 reconnaissable trouvée dans DG2");
}

const DG15_TAG = 0x6f;

/**
 * Extrait la clé publique Active Authentication (SubjectPublicKeyInfo DER) depuis DG15 (Doc 9303
 * Part 10 §4.7.15) : `[APPLICATION 15] SubjectPublicKeyInfo`, un unique niveau de TLV (tag 0x6F)
 * enveloppant directement le SPKI — structure simple et non ambiguë, contrairement à DG2.
 */
export function extractDg15PublicKey(dg15: Uint8Array): Uint8Array {
  const { value } = readSingleByteTagTlv(dg15, 0, DG15_TAG);
  return value;
}

/** DG1 — MRZ telle que stockée sur la puce (doit être identique à la MRZ imprimée). */
export interface DataGroup1 {
  mrzLines: string[];
}

/** DG2 — image du visage (Doc 9303 Part 10 §6), au format biométrique CBEFF/JPEG ou JPEG2000. */
export interface DataGroup2 {
  imageFormat: "JPEG" | "JPEG2000";
  imageBytes: Uint8Array;
}

/**
 * DG14 — infos de sécurité pour Chip Authentication (Doc 9303 Part 11 §5). Analyse complète des
 * SecurityInfos et protocole lui-même : nfc/chipAuthentication.ts.
 */
export interface DataGroup14 {
  chipAuthenticationPublicKeyOid: string;
  chipAuthenticationPublicKey: Uint8Array;
}

/** DG15 — clé publique pour Active Authentication (Doc 9303 Part 11 §6). */
export interface DataGroup15 {
  activeAuthenticationPublicKey: Uint8Array;
}

export interface ParsedDataGroups {
  dg1?: DataGroup1;
  dg2?: DataGroup2;
  dg14?: DataGroup14;
  dg15?: DataGroup15;
  /** Autres DG présents mais non interprétés par cette version (voir docs/roadmap.md). */
  raw: RawDataGroup[];
}
