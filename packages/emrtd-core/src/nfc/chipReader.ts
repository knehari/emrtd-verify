import { isSuccess, formatStatusWord, type CommandApduInput } from "./apdu";
import { unwrapResponseApdu, wrapCommandApdu, type SecureMessagingKeys } from "./secureMessaging";
import type { ApduTransceiver } from "./bac";

/**
 * Lecture des fichiers eMRTD (EF.SOD + groupes de données) via SELECT/READ BINARY protégés par
 * messagerie sécurisée, une fois le canal BAC établi (bac.ts). AID, identifiants de fichier (FID)
 * et conventions SELECT P1/P2 confirmés byte-exact indépendamment contre la suite de conformité
 * officielle ETSI (STF400, `ePassport-master.zip` fourni par l'utilisateur) :
 * - `ePassport_Values.ttcn` : AID = a0000002471001, FID identiques pour DG1..DG16/EF.SOD/EF.COM.
 * - `ePassport_Templates.ttcn`/`ePassport_Types.ttcn` : SELECT AID → P1=0x04 (`e_selectByDFName`),
 *   SELECT EF → P1=0x02 (`e_selectEFUnderCurrentDF`), P2=0x0C dans les deux cas
 *   (`e_noResponseOrProprietary`<<2 | `e_firstOrOnlyOccurrence`).
 * Voir chipReader.test.ts pour la vérification par construction. La stratégie de lecture (sonder
 * l'en-tête ASN.1 DER pour connaître la longueur exacte, puis lire par blocs de `maxChunkSize`)
 * minimise les allers-retours NFC — voir `ChipReaderConfig`.
 */

const EMRTD_APPLICATION_AID = Uint8Array.of(0xa0, 0x00, 0x00, 0x02, 0x47, 0x10, 0x01);

const EF_SOD_FID = 0x011d;
const EF_COM_FID = 0x011e;

/** DGn → FID = 0x01(n) (Doc 9303 Part 10 Table 4) — DG1..DG16. */
function dataGroupFileId(dataGroupNumber: number): number {
  if (dataGroupNumber < 1 || dataGroupNumber > 16) {
    throw new ChipReaderError(`Numéro de groupe de données invalide : DG${dataGroupNumber} (attendu 1..16)`);
  }
  return 0x0100 | dataGroupNumber;
}

export class ChipReaderError extends Error {}

export interface ChipReaderConfig {
  /**
   * Nombre max d'octets demandés par READ BINARY. Plus grand = moins d'allers-retours NFC (donc
   * lecture plus rapide), au prix d'APDU en forme étendue si > 255 — n'augmenter que si la puce
   * a annoncé le supporter (sinon garder la valeur par défaut, sûre en forme courte).
   */
  maxChunkSize?: number;
  /** Appelé après chaque fichier lu (EF.SOD puis chaque DG) — progression affichée pendant la lecture NFC. */
  onProgress?: (filesRead: number, filesTotal: number) => void;
}

const DEFAULT_MAX_CHUNK_SIZE = 200;

/** Référence mutable vers le SSC courant — la messagerie sécurisée avance à CHAQUE échange, donc
 * chaque appel à smExchange doit lire/écrire le même état partagé sur toute une session de lecture. */
interface SscRef {
  current: Uint8Array;
}

async function smExchange(
  transceiver: ApduTransceiver,
  keys: SecureMessagingKeys,
  sscRef: SscRef,
  command: CommandApduInput,
) {
  const { wrapped, nextSsc: sscAfterCommand } = wrapCommandApdu(command, keys, sscRef.current);
  sscRef.current = sscAfterCommand;
  const raw = await transceiver.transceive(wrapped);
  const { response, nextSsc: sscAfterResponse } = unwrapResponseApdu(raw, keys, sscRef.current);
  sscRef.current = sscAfterResponse;
  return response;
}

async function selectByAid(transceiver: ApduTransceiver, keys: SecureMessagingKeys, sscRef: SscRef, aid: Uint8Array): Promise<void> {
  const response = await smExchange(transceiver, keys, sscRef, { cla: 0x00, ins: 0xa4, p1: 0x04, p2: 0x0c, data: aid });
  if (!isSuccess(response)) {
    throw new ChipReaderError(`SELECT AID a échoué : SW=${formatStatusWord(response)}`);
  }
}

async function selectByFileId(transceiver: ApduTransceiver, keys: SecureMessagingKeys, sscRef: SscRef, fid: number): Promise<void> {
  const data = Uint8Array.of((fid >> 8) & 0xff, fid & 0xff);
  const response = await smExchange(transceiver, keys, sscRef, { cla: 0x00, ins: 0xa4, p1: 0x02, p2: 0x0c, data });
  if (!isSuccess(response)) {
    throw new ChipReaderError(`SELECT EF 0x${fid.toString(16).padStart(4, "0")} a échoué : SW=${formatStatusWord(response)}`);
  }
}

async function readBinaryChunk(
  transceiver: ApduTransceiver,
  keys: SecureMessagingKeys,
  sscRef: SscRef,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  if (offset > 0x7fff) {
    throw new ChipReaderError(`Décalage READ BINARY hors plage forme courte (${offset}) — non supporté par cette implémentation`);
  }
  const p1 = (offset >> 8) & 0xff;
  const p2 = offset & 0xff;
  const response = await smExchange(transceiver, keys, sscRef, { cla: 0x00, ins: 0xb0, p1, p2, le: length });
  if (!isSuccess(response)) {
    throw new ChipReaderError(`READ BINARY à l'offset ${offset} a échoué : SW=${formatStatusWord(response)}`);
  }
  return response.data;
}

/** Longueur ASN.1 DER (définie uniquement) à partir de `offset` — 1 octet si <0x80, sinon (0x80|N) suivi de N octets de longueur. */
function parseDerLength(bytes: Uint8Array, offset: number): { length: number; headerLength: number } {
  if (offset >= bytes.length) {
    throw new ChipReaderError("Fichier trop court pour contenir un en-tête TLV ASN.1 valide");
  }
  const first = bytes[offset];
  if (first < 0x80) {
    return { length: first, headerLength: 1 };
  }
  const numLengthBytes = first & 0x7f;
  if (numLengthBytes < 1 || numLengthBytes > 3 || offset + 1 + numLengthBytes > bytes.length) {
    throw new ChipReaderError(`Longueur ASN.1 DER non supportée ou tronquée (préfixe 0x${first.toString(16)})`);
  }
  let length = 0;
  for (let i = 0; i < numLengthBytes; i++) {
    length = (length << 8) | bytes[offset + 1 + i];
  }
  return { length, headerLength: 1 + numLengthBytes };
}

/**
 * Sélectionne puis lit un fichier eMRTD dans son intégralité : sonde d'abord les premiers octets
 * pour connaître la longueur ASN.1 DER exacte, puis lit le reste par blocs de `maxChunkSize` —
 * évite de sur-lire (au-delà de la fin réelle du fichier) ou de sous-lire (boucle READ BINARY
 * jusqu'à la longueur exacte annoncée par le TLV, pas par une fin de fichier renvoyée par la puce).
 */
export async function readFile(
  transceiver: ApduTransceiver,
  keys: SecureMessagingKeys,
  sscRef: SscRef,
  fid: number,
  config?: ChipReaderConfig,
): Promise<Uint8Array> {
  await selectByFileId(transceiver, keys, sscRef, fid);
  const maxChunk = config?.maxChunkSize ?? DEFAULT_MAX_CHUNK_SIZE;

  const probeSize = Math.min(6, maxChunk);
  const headerProbe = await readBinaryChunk(transceiver, keys, sscRef, 0, probeSize);
  if (headerProbe.length < 2) {
    throw new ChipReaderError(`Fichier 0x${fid.toString(16).padStart(4, "0")} trop court pour contenir un en-tête TLV valide`);
  }
  const { length: bodyLength, headerLength } = parseDerLength(headerProbe, 1); // octet 0 = tag
  const totalLength = 1 + headerLength + bodyLength;

  const result = new Uint8Array(totalLength);
  result.set(headerProbe.subarray(0, Math.min(headerProbe.length, totalLength)), 0);
  let readSoFar = Math.min(headerProbe.length, totalLength);

  while (readSoFar < totalLength) {
    const remaining = totalLength - readSoFar;
    const chunkSize = Math.min(remaining, maxChunk);
    const chunk = await readBinaryChunk(transceiver, keys, sscRef, readSoFar, chunkSize);
    if (chunk.length === 0) {
      throw new ChipReaderError(
        `READ BINARY à l'offset ${readSoFar} n'a renvoyé aucune donnée alors que ${remaining} octet(s) restaient attendus sur 0x${fid.toString(16)}`,
      );
    }
    result.set(chunk.subarray(0, Math.min(chunk.length, remaining)), readSoFar);
    readSoFar += chunk.length;
  }

  return result;
}

export interface ChipReadResult {
  sod: Uint8Array;
  dataGroups: Record<number, Uint8Array>;
}

/**
 * Point d'entrée complet : sélectionne l'application eMRTD, lit EF.SOD puis chaque DG demandé.
 * `ssc`/`keys` proviennent de `performBacHandshake` (bac.ts) — un seul SSC partagé fait avancer
 * la messagerie sécurisée de façon cohérente sur toute la session, SELECT et READ BINARY compris.
 */
export async function readEmrtdChipData(
  transceiver: ApduTransceiver,
  keys: SecureMessagingKeys,
  initialSsc: Uint8Array,
  dataGroupNumbers: number[],
  config?: ChipReaderConfig,
): Promise<ChipReadResult> {
  const sscRef: SscRef = { current: initialSsc };
  await selectByAid(transceiver, keys, sscRef, EMRTD_APPLICATION_AID);

  const filesTotal = 1 + dataGroupNumbers.length;
  const sod = await readFile(transceiver, keys, sscRef, EF_SOD_FID, config);
  config?.onProgress?.(1, filesTotal);

  const dataGroups: Record<number, Uint8Array> = {};
  for (const [index, dgNumber] of dataGroupNumbers.entries()) {
    dataGroups[dgNumber] = await readFile(transceiver, keys, sscRef, dataGroupFileId(dgNumber), config);
    config?.onProgress?.(index + 2, filesTotal);
  }

  return { sod, dataGroups };
}

export { EF_SOD_FID, EF_COM_FID, EMRTD_APPLICATION_AID, dataGroupFileId };
