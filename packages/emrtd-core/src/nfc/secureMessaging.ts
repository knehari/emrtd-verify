import { buildCommandApdu, parseResponseApdu, type CommandApduInput, type ResponseApdu } from "./apdu";
import { computeRetailMac, constantTimeEquals, padIso9797Method2, unpadIso9797Method2 } from "../crypto/retailMac";
import { tripleDesCbcDecrypt, tripleDesCbcEncrypt } from "../crypto/tripleDes";

/**
 * Messagerie sécurisée BAC (Doc 9303 Part 11 §4.3/Appendix D.3, structure BER-TLV ISO/IEC 7816-4
 * §8.2) : chiffre/authentifie chaque APDU échangée avec la puce après l'établissement du canal
 * (bac.ts). Confirmée byte-exact contre l'exemple travaillé officiel ICAO (Doc 9303 Part 11
 * Appendix D.4, pages scannées fournies par l'utilisateur) : wrapCommandApdu/unwrapResponseApdu
 * reproduisent EXACTEMENT chaque octet (CmdHeader, DO87, N, MAC, DO8E, ProtectedAPDU, SSC à
 * chaque étape) de la lecture protégée d'EF.COM (SELECT puis READ BINARY) — voir
 * secureMessaging.test.ts "exemple travaillé officiel ICAO". Également validée par round-trip
 * et par une simulation à deux côtés indépendants pour les propriétés de sécurité (rejet sur
 * falsification, désynchronisation SSC).
 */

export interface SecureMessagingKeys {
  /** Clé de session post-authentification pour le chiffrement (KSenc), 16 octets. */
  ksEnc: Uint8Array;
  /** Clé de session post-authentification pour le MAC (KSmac), 16 octets. */
  ksMac: Uint8Array;
}

export class SecureMessagingError extends Error {}

const ZERO_IV = new Uint8Array(8);

/** Incrémente le compteur de séquence d'envoi (SSC, 8 octets, big-endian) — jamais muté en place. */
export function incrementSsc(ssc: Uint8Array): Uint8Array {
  if (ssc.length !== 8) {
    throw new Error(`SSC invalide : attendu 8 octets, reçu ${ssc.length}`);
  }
  const next = Uint8Array.from(ssc);
  for (let i = 7; i >= 0; i--) {
    next[i] = (next[i] + 1) & 0xff;
    if (next[i] !== 0) break; // pas de retenue, arrêt de la propagation
  }
  return next;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Encode la longueur BER-TLV (définie uniquement, forme courte ou longue sur 1/2/3 octets — suffisant jusqu'à 65535 octets, largement au-delà de tout DG eMRTD). */
function encodeBerLength(length: number): Uint8Array {
  if (length < 0x80) return Uint8Array.of(length);
  if (length <= 0xff) return Uint8Array.of(0x81, length);
  if (length <= 0xffff) return Uint8Array.of(0x82, (length >> 8) & 0xff, length & 0xff);
  throw new Error(`Longueur BER-TLV non supportée : ${length}`);
}

function encodeTlv(tag: number, value: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(tag), encodeBerLength(value.length), value);
}

interface ParsedTlv {
  tag: number;
  value: Uint8Array;
  /** Décalage juste après cette TLV, pour reprendre l'analyse du DO suivant. */
  nextOffset: number;
}

/** Analyse une seule TLV BER-TLV (longueur définie uniquement) à partir de `offset`. */
function parseTlv(bytes: Uint8Array, offset: number): ParsedTlv {
  if (offset >= bytes.length) {
    throw new SecureMessagingError("Données de messagerie sécurisée tronquées (TLV attendue)");
  }
  const tag = bytes[offset];
  const firstLengthByte = bytes[offset + 1];
  let length: number;
  let valueOffset: number;
  if (firstLengthByte < 0x80) {
    length = firstLengthByte;
    valueOffset = offset + 2;
  } else if (firstLengthByte === 0x81) {
    length = bytes[offset + 2];
    valueOffset = offset + 3;
  } else if (firstLengthByte === 0x82) {
    length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    valueOffset = offset + 4;
  } else {
    throw new SecureMessagingError(`Forme de longueur BER-TLV non supportée : 0x${firstLengthByte.toString(16)}`);
  }
  const value = bytes.subarray(valueOffset, valueOffset + length);
  if (value.length !== length) {
    throw new SecureMessagingError("Données de messagerie sécurisée tronquées (valeur TLV incomplète)");
  }
  return { tag, value, nextOffset: valueOffset + length };
}

/**
 * Emballe une commande logique (avant SM) en APDU protégée — DO87 (données chiffrées, si
 * présentes), DO97 (Le protégé, si présent), DO8E (MAC sur SSC||en-tête paddé||DO87||DO97) — et
 * consomme un incrément de SSC (un par cryptogramme construit, comme l'exige Doc 9303 Appendix
 * D.3). CLA est forcé à 0x0C (bit "secure messaging" ISO/IEC 7816-4 §5.1.1) quelle que soit la
 * valeur d'entrée.
 */
export function wrapCommandApdu(
  command: CommandApduInput,
  keys: SecureMessagingKeys,
  ssc: Uint8Array,
): { wrapped: Uint8Array; nextSsc: Uint8Array } {
  const nextSsc = incrementSsc(ssc);

  const maskedCla = 0x0c;
  const paddedHeader = padIso9797Method2(Uint8Array.of(maskedCla, command.ins, command.p1, command.p2));

  const domainObjects: Uint8Array[] = [];
  if (command.data && command.data.length > 0) {
    const encrypted = tripleDesCbcEncrypt(keys.ksEnc, ZERO_IV, padIso9797Method2(command.data));
    // Octet indicateur de padding 0x01 (ISO/IEC 7816-4 §8.2.1.1) devant les données chiffrées.
    domainObjects.push(encodeTlv(0x87, concatBytes(Uint8Array.of(0x01), encrypted)));
  }
  if (command.le !== undefined) {
    domainObjects.push(encodeTlv(0x97, Uint8Array.of(command.le === 0 ? 0x00 : command.le & 0xff)));
  }

  const macInput = padIso9797Method2(concatBytes(nextSsc, paddedHeader, ...domainObjects));
  const mac = computeRetailMac(keys.ksMac, macInput);
  domainObjects.push(encodeTlv(0x8e, mac));

  const protectedBody = concatBytes(...domainObjects);
  const wrapped = buildCommandApdu({
    cla: maskedCla,
    ins: command.ins,
    p1: command.p1,
    p2: command.p2,
    data: protectedBody,
    le: 0,
  });

  return { wrapped, nextSsc };
}

/**
 * Déballe une réponse protégée : vérifie DO8E AVANT tout déchiffrement (rejette sur MAC invalide
 * sans jamais exposer de texte déchiffré non authentifié — voir SecureMessagingError), déchiffre
 * DO87 si présent, restitue le statut réel porté par DO99.
 */
export function unwrapResponseApdu(
  rawResponse: Uint8Array,
  keys: SecureMessagingKeys,
  ssc: Uint8Array,
): { response: ResponseApdu; nextSsc: Uint8Array } {
  const nextSsc = incrementSsc(ssc);
  const outer = parseResponseApdu(rawResponse);

  let encryptedDataObject: Uint8Array | undefined;
  let statusObject: Uint8Array | undefined;
  let macObject: Uint8Array | undefined;
  let offset = 0;
  const authenticatedObjects: Uint8Array[] = [];
  while (offset < outer.data.length) {
    const tlv = parseTlv(outer.data, offset);
    const raw = outer.data.subarray(offset, tlv.nextOffset);
    if (tlv.tag === 0x87) {
      encryptedDataObject = tlv.value;
      authenticatedObjects.push(raw);
    } else if (tlv.tag === 0x99) {
      statusObject = tlv.value;
      authenticatedObjects.push(raw);
    } else if (tlv.tag === 0x8e) {
      macObject = tlv.value;
      // DO8E lui-même n'entre pas dans le calcul du MAC qu'il porte.
    } else {
      throw new SecureMessagingError(`Objet de données de messagerie sécurisée inattendu : tag 0x${tlv.tag.toString(16)}`);
    }
    offset = tlv.nextOffset;
  }

  if (!macObject) {
    throw new SecureMessagingError("Réponse protégée sans DO8E (MAC absent) — rejetée");
  }

  const macInput = padIso9797Method2(concatBytes(nextSsc, ...authenticatedObjects));
  const expectedMac = computeRetailMac(keys.ksMac, macInput);
  if (!constantTimeEquals(expectedMac, macObject)) {
    throw new SecureMessagingError("MAC de messagerie sécurisée invalide — réponse rejetée (altération ou clés désynchronisées)");
  }

  let data: Uint8Array = new Uint8Array(0);
  if (encryptedDataObject) {
    if (encryptedDataObject.length < 1 || encryptedDataObject[0] !== 0x01) {
      throw new SecureMessagingError("DO87 sans octet indicateur de padding 0x01 attendu");
    }
    const decrypted = tripleDesCbcDecrypt(keys.ksEnc, ZERO_IV, encryptedDataObject.subarray(1));
    data = unpadIso9797Method2(decrypted);
  }

  let sw1 = outer.sw1;
  let sw2 = outer.sw2;
  if (statusObject) {
    if (statusObject.length !== 2) {
      throw new SecureMessagingError("DO99 de longueur invalide (attendu 2 octets SW1SW2)");
    }
    [sw1, sw2] = statusObject;
  }

  return { response: { data, sw1, sw2 }, nextSsc };
}
