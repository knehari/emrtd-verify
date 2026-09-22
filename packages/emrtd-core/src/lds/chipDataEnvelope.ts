import type { DataGroupNumber, DocumentIdentity, DocumentType } from "@emrtd-verify/shared-types";
import { bytesToBase64, base64ToBytes } from "../crypto/base64";
import { sha256 } from "../crypto/sha256";
import { sha384, sha512 } from "../crypto/sha512";
import { decodeSod, type DataGroupHash, type DigestAlgorithm } from "./sod";
import { extractDg1MrzText, splitMrzTextIntoLines, extractDg2FaceImage, extractDg15PublicKey, asciiBytesToString } from "./dataGroups";
import { parseMrzTd3, parseMrzTd1 } from "../mrz/mrzParser";
import type { MrzFieldValidation } from "../mrz/types";
import { verifyActiveAuthenticationResponse, type ActiveAuthenticationVerification } from "./activeAuthentication";

export class ChipDataEnvelopeError extends Error {}

/**
 * Format d'échange (JSON, encodé en base64) portant les octets bruts lus sur la puce
 * (`SubmitVerificationDto.chipData`) — point de rencontre entre apps/mobile (qui les produit,
 * via une lecture NFC BAC/PACE authentifiée, voir apps/mobile/src/nfc/emrtdReader.ts) et
 * apps/api (qui les consomme, en ligne comme hors ligne). Source de vérité UNIQUE : ni apps/mobile
 * ni apps/api ne doivent réimplémenter ce format séparément (voir docs/pki-trust-model.md
 * "Vérification hors ligne").
 */
export interface ChipDataEnvelope {
  formatVersion: 1;
  /** EF.SOD (CMS SignedData), DER, en base64. */
  sodDerBase64: string;
  /** Clé = numéro de DG (chaîne décimale, ex. "1", "2", "15"), valeur = octets TLV bruts du DG en base64. */
  dataGroups: Record<string, string>;
  /** Présent uniquement si une session Active/Chip Authentication a été menée pendant la lecture NFC. */
  activeAuthentication?: {
    challengeBase64: string;
    responseDerBase64: string;
  };
}

/**
 * Construit l'objet `ChipDataEnvelope` à partir des octets bruts lus sur la puce — séparé
 * d'`encodeChipDataEnvelope` pour permettre un usage purement local (voir apps/mobile
 * src/verification/localVerification.ts) sans passer par le format fil (base64 de JSON), qui n'a
 * de sens que pour la transmission réseau vers apps/api.
 */
export function buildChipDataEnvelope(input: {
  sod: Uint8Array;
  dataGroups: Record<number, Uint8Array>;
  activeAuthentication?: { challenge: Uint8Array; responseDer: Uint8Array };
}): ChipDataEnvelope {
  return {
    formatVersion: 1,
    sodDerBase64: bytesToBase64(input.sod),
    dataGroups: Object.fromEntries(Object.entries(input.dataGroups).map(([number, bytes]) => [number, bytesToBase64(bytes)])),
    activeAuthentication: input.activeAuthentication
      ? {
          challengeBase64: bytesToBase64(input.activeAuthentication.challenge),
          responseDerBase64: bytesToBase64(input.activeAuthentication.responseDer),
        }
      : undefined,
  };
}

/** Encode les octets bruts lus sur la puce dans le format `chipData` attendu par POST /v1/verifications. */
export function encodeChipDataEnvelope(input: {
  sod: Uint8Array;
  dataGroups: Record<number, Uint8Array>;
  activeAuthentication?: { challenge: Uint8Array; responseDer: Uint8Array };
}): string {
  const envelope = buildChipDataEnvelope(input);
  // Le JSON produit ici ne contient que des chaînes base64/nombres/clés ASCII — TextEncoder
  // (déjà utilisé ailleurs dans ce package, voir mrz/bacKey.ts) suffit, pas besoin d'un codec dédié.
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(envelope)));
}

/** Décode et valide superficiellement la structure de `chipData` (pas son contenu cryptographique — voir `decodeChipDataEnvelope`). */
export function parseChipDataEnvelope(chipDataBase64: string): ChipDataEnvelope {
  let parsed: unknown;
  try {
    const json = asciiBytesToString(base64ToBytes(chipDataBase64));
    parsed = JSON.parse(json);
  } catch (error) {
    throw new ChipDataEnvelopeError(`chipData illisible (base64/JSON invalide) : ${String(error)}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as ChipDataEnvelope).formatVersion !== 1 ||
    typeof (parsed as ChipDataEnvelope).sodDerBase64 !== "string" ||
    typeof (parsed as ChipDataEnvelope).dataGroups !== "object"
  ) {
    throw new ChipDataEnvelopeError("chipData structurellement invalide (formatVersion/sodDerBase64/dataGroups attendus)");
  }
  return parsed as ChipDataEnvelope;
}

function getOptionalDataGroup(envelope: ChipDataEnvelope, number: number): Uint8Array | undefined {
  const base64 = envelope.dataGroups[String(number)];
  return base64 !== undefined ? base64ToBytes(base64) : undefined;
}

function getRequiredDataGroup(envelope: ChipDataEnvelope, number: number): Uint8Array {
  const bytes = getOptionalDataGroup(envelope, number);
  if (!bytes) {
    throw new ChipDataEnvelopeError(`DG${number} absent de chipData (requis)`);
  }
  return bytes;
}

function computeDataGroupHash(digestAlgorithm: DigestAlgorithm, bytes: Uint8Array): Uint8Array {
  switch (digestAlgorithm) {
    case "SHA-256":
      return sha256(bytes);
    case "SHA-384":
      return sha384(bytes);
    case "SHA-512":
      return sha512(bytes);
  }
}

/**
 * Résultat de l'extraction des données de puce, prêt à alimenter la Passive Authentication
 * (`validateTrustChain`, packages/pki-trust), la détection d'anomalies et la comparaison faciale
 * — même contrat qu'auparavant `apps/api/src/modules/verification/chip-data.decoder.ts`
 * (désormais un alias vers ce type, voir ce fichier), pour rester utilisable identiquement en
 * ligne (apps/api) et hors ligne (apps/mobile).
 */
export interface DecodedChipData {
  sodDer: Uint8Array;
  computedDataGroupHashes: DataGroupHash[];
  documentIdentity: DocumentIdentity;
  mrzValidation: MrzFieldValidation;
  /** Image DG2 (visage), si présente et reconnaissable — voir extractDg2FaceImage. */
  faceImage?: Uint8Array;
  /** undefined si le document n'a pas présenté de session Active/Chip Authentication du tout. */
  activeAuthentication?: ActiveAuthenticationVerification;
}

/**
 * Décode intégralement un `ChipDataEnvelope` : SOD (sans vérifier sa signature ni sa confiance —
 * voir `validateTrustChain`, packages/pki-trust, qui fait les deux à partir de `sodDer` +
 * `computedDataGroupHashes` ci-dessous), MRZ (DG1), image du visage (DG2, best-effort), et
 * Active/Chip Authentication (DG15, si présente et si une réponse a été fournie). Fonction pure et
 * portable (Node ET React Native) — appelée à l'identique par apps/api (chemin en ligne) et
 * apps/mobile (chemin hors ligne, voir docs/pki-trust-model.md "Vérification hors ligne").
 */
export async function decodeChipDataEnvelope(envelope: ChipDataEnvelope, documentType: DocumentType): Promise<DecodedChipData> {
  const sodDer = base64ToBytes(envelope.sodDerBase64);
  const decodedSod = decodeSod(sodDer);

  const dg1Bytes = getRequiredDataGroup(envelope, 1);
  const mrzText = extractDg1MrzText(dg1Bytes);
  const mrzLines = splitMrzTextIntoLines(mrzText);
  const parsedMrz = mrzLines.length === 2 ? parseMrzTd3(mrzLines[0]!, mrzLines[1]!, documentType) : parseMrzTd1(mrzLines[0]!, mrzLines[1]!, mrzLines[2]!, documentType);

  let faceImage: Uint8Array | undefined;
  const dg2Bytes = getOptionalDataGroup(envelope, 2);
  if (dg2Bytes) {
    try {
      faceImage = extractDg2FaceImage(dg2Bytes).imageBytes;
    } catch {
      // DG2 présent mais image non reconnaissable : dégrade sans bloquer tout le décodage (voir
      // extractDg2FaceImage, extraction pragmatique par signature — pas un décodeur CBEFF complet).
      faceImage = undefined;
    }
  }

  let activeAuthentication: ActiveAuthenticationVerification | undefined;
  const dg15Bytes = getOptionalDataGroup(envelope, 15);
  if (dg15Bytes && envelope.activeAuthentication) {
    try {
      const dg15PublicKeyDer = extractDg15PublicKey(dg15Bytes);
      activeAuthentication = await verifyActiveAuthenticationResponse({
        dg15PublicKeyDer,
        challenge: base64ToBytes(envelope.activeAuthentication.challengeBase64),
        responseDer: base64ToBytes(envelope.activeAuthentication.responseDerBase64),
      });
    } catch (error) {
      activeAuthentication = { supported: false, valid: false, reason: `DG15/réponse AA illisible : ${String(error)}` };
    }
  }

  const computedDataGroupHashes: DataGroupHash[] = Object.entries(envelope.dataGroups).map(([numberText, base64]) => ({
    dataGroupNumber: Number(numberText) as DataGroupNumber,
    hash: computeDataGroupHash(decodedSod.document.ldsSecurityObject.digestAlgorithm, base64ToBytes(base64)),
  }));

  return {
    sodDer,
    computedDataGroupHashes,
    documentIdentity: parsedMrz.identity,
    mrzValidation: parsedMrz.validation,
    faceImage,
    activeAuthentication,
  };
}
