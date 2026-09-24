import { fromBER, Integer, Sequence } from "asn1js";
import { toArrayBuffer } from "../crypto/bytes";
import { hashBytes, parseSubjectPublicKeyInfo, rsaPublicOperation, verifySignaturePure, type HashName } from "../crypto/pureVerify";
import { bigIntToBytes, bytesToBigInt } from "../crypto/ecCurves";

/**
 * Active Authentication (Doc 9303 Part 11 §6) : le terminal envoie un défi aléatoire à la
 * puce (commande INTERNAL AUTHENTICATE), qui le signe avec sa clé privée — jamais exportée
 * de la puce — et renvoie la signature. Le terminal vérifie avec la clé publique portée par
 * DG15.
 *
 * Périmètre : ECDSA et RSA ISO/IEC 9796-2 schéma 1 (validé contre des signatures produites par
 * OpenSSL, voir activeAuthentication.test.ts). L'envoi du défi est fait par
 * nfc/chipReader.ts (`readEmrtdChipData`, option `activeAuthenticationChallenge`).
 */

export interface ActiveAuthenticationVerification {
  /** false si la clé DG15 utilise un algorithme non couvert (ex. RSA-9796-2) — voir docstring du module. */
  supported: boolean;
  /** Signification uniquement quand supported === true. */
  valid: boolean;
  reason?: string;
}

/** Retire l'octet 0x00 de tête qu'ASN.1 DER ajoute à un INTEGER positif dont le bit de poids fort est posé. */
function stripDerIntegerPadding(bytes: Uint8Array): Uint8Array {
  return bytes.length > 1 && bytes[0] === 0x00 && (bytes[1] & 0x80) !== 0 ? bytes.slice(1) : bytes;
}

function padLeft(bytes: Uint8Array, length: number): Uint8Array {
  if (bytes.length > length) {
    throw new Error(`Composante de signature ECDSA trop longue (${bytes.length} > ${length} octets)`);
  }
  const padded = new Uint8Array(length);
  padded.set(bytes, length - bytes.length);
  return padded;
}

/**
 * Convertit une signature ECDSA au format DER (SEQUENCE { r INTEGER, s INTEGER } — convention
 * ISO/IEC 7816-8, celle attendue d'une puce eMRTD réelle) vers le format "raw" r‖s attendu par
 * SubtleCrypto.verify (IEEE P1363, Web Crypto ne supporte jamais DER directement pour ECDSA).
 */
export function derEcdsaSignatureToRaw(der: Uint8Array, componentLength: number): Uint8Array {
  const asn1 = fromBER(toArrayBuffer(der));
  if (asn1.offset === -1) {
    throw new Error("Signature ECDSA invalide : échec du décodage ASN.1 DER");
  }
  const [r, s] = (asn1.result as Sequence).valueBlock.value as [Integer, Integer];
  const rBytes = padLeft(stripDerIntegerPadding(new Uint8Array(r.valueBlock.valueHexView)), componentLength);
  const sBytes = padLeft(stripDerIntegerPadding(new Uint8Array(s.valueBlock.valueHexView)), componentLength);

  const raw = new Uint8Array(componentLength * 2);
  raw.set(rBytes, 0);
  raw.set(sBytes, componentLength);
  return raw;
}

/** Octet d'identification de hachage ISO/IEC 10118-3 dans le trailer 2 octets ("xx CC") d'ISO/IEC 9796-2. */
const ISO9796_HASH_IDS: Record<number, HashName> = { 0x33: "SHA-1", 0x34: "SHA-256", 0x35: "SHA-512", 0x36: "SHA-384", 0x38: "SHA-224" };
const HASH_LENGTHS: Record<HashName, number> = { "SHA-1": 20, "SHA-224": 28, "SHA-256": 32, "SHA-384": 48, "SHA-512": 64 };

/**
 * RSA — ISO/IEC 9796-2 schéma 1, récupération partielle du message (Doc 9303 Part 11 §6.1) :
 * F = s^e mod n = 6A || M1 || H(M1 || M2) || BC (SHA-1) ou … || hashId CC. M2 est le défi envoyé ;
 * M1, choisi par la puce, est récupéré de la signature. Même logique que JMRTD
 * (`AAProtocol`/`recoverMessage`) : en-tête 01xx, bit de récupération partielle, trailer 1 ou 2 octets.
 */
function verifyRsaIso9796(key: { n: bigint; e: bigint }, challenge: Uint8Array, signature: Uint8Array): { valid: boolean; reason?: string } {
  const decoded = rsaPublicOperation(key, signature);
  if (!decoded) return { valid: false, reason: "Signature RSA de taille incohérente avec la clé DG15" };
  const candidates = [decoded];
  // Variante ISO 9796-2 : si J ≢ 12 (mod 16), la valeur signée est n − J.
  const k = decoded.length;
  const j = bytesToBigInt(decoded);
  candidates.push(bigIntToBytes(key.n - j, k));
  for (const f of candidates) {
    const last = f[f.length - 1];
    let hash: HashName | undefined;
    let trailerLength = 0;
    if (last === 0xbc) {
      hash = "SHA-1";
      trailerLength = 1;
    } else if (last === 0xcc) {
      hash = ISO9796_HASH_IDS[f[f.length - 2]];
      trailerLength = 2;
    }
    // En-tête : bits de poids fort "01" ; le bit suivant (0x20) signale la récupération partielle.
    if (!hash || (f[0] & 0xc0) !== 0x40) continue;
    // Récupération TOTALE refusée : le défi (M2) ne serait alors pas couvert par la signature,
    // qui pourrait être rejouée — Doc 9303 impose la récupération partielle pour AA.
    if ((f[0] & 0x20) === 0) return { valid: false, reason: "ISO 9796-2 sans récupération partielle : le défi n'est pas signé" };
    const digestLength = HASH_LENGTHS[hash];
    const digestStart = f.length - trailerLength - digestLength;
    if (digestStart <= 1) continue;
    const m1 = f.subarray(1, digestStart);
    const expected = hashBytes(hash, new Uint8Array([...m1, ...challenge]));
    const actual = f.subarray(digestStart, digestStart + digestLength);
    return { valid: constantTimeEqual(expected, actual), reason: constantTimeEqual(expected, actual) ? undefined : "Empreinte ISO 9796-2 incorrecte" };
  }
  return { valid: false, reason: "Format ISO/IEC 9796-2 non reconnu (en-tête ou trailer invalide)" };
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Vérifie la réponse à INTERNAL AUTHENTICATE contre la clé publique de DG15, en JavaScript pur
 * (fonctionne sur React Native, sans Web Crypto) : ECDSA (signature plain r||s ou DER ; hachage
 * donné par ActiveAuthenticationInfo de DG14 s'il est connu, sinon chacun des hachages admis par
 * Doc 9303 est essayé — un faussaire doit de toute façon produire une signature valide sur un défi
 * aléatoire frais) et RSA ISO/IEC 9796-2 schéma 1.
 */
export async function verifyActiveAuthenticationResponse(options: {
  /** SubjectPublicKeyInfo DER tel que porté par DG15 (Doc 9303 Part 10). */
  dg15PublicKeyDer: Uint8Array;
  /** Défi aléatoire envoyé à la puce (commande INTERNAL AUTHENTICATE). */
  challenge: Uint8Array;
  /** Réponse de la puce (données de la réponse à INTERNAL AUTHENTICATE). */
  responseDer: Uint8Array;
  /** Hachage annoncé par ActiveAuthenticationInfo (DG14), pour les clés EC. */
  hashAlgorithm?: HashName;
}): Promise<ActiveAuthenticationVerification> {
  let key: ReturnType<typeof parseSubjectPublicKeyInfo>;
  try {
    key = parseSubjectPublicKeyInfo(options.dg15PublicKeyDer);
  } catch (error) {
    return { supported: false, valid: false, reason: `Clé publique DG15 non prise en charge : ${String(error)}` };
  }
  if (key.kind === "RSA") {
    const result = verifyRsaIso9796(key, options.challenge, options.responseDer);
    return { supported: true, ...result };
  }
  const hashes: HashName[] = options.hashAlgorithm ? [options.hashAlgorithm] : ["SHA-256", "SHA-1", "SHA-384", "SHA-512", "SHA-224"];
  for (const hash of hashes) {
    const valid = verifySignaturePure({
      spkiDer: options.dg15PublicKeyDer,
      scheme: { kind: "ECDSA", hash },
      signature: options.responseDer,
      signedData: options.challenge,
    });
    if (valid) return { supported: true, valid: true };
  }
  return { supported: true, valid: false, reason: "Signature ECDSA du défi invalide pour la clé DG15" };
}
