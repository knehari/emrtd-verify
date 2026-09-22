import { decodeChipDataEnvelope, parseChipDataEnvelope, type DecodedChipData } from "@emrtd-verify/emrtd-core";
import type { DocumentType } from "@emrtd-verify/shared-types";

/**
 * Résultat de l'extraction des données de puce — alias de `DecodedChipData`
 * (packages/emrtd-core/src/lds/chipDataEnvelope.ts), la source de vérité unique partagée avec
 * apps/mobile pour que le décodage soit identique en ligne (ici) et hors ligne (voir
 * docs/pki-trust-model.md "Vérification hors ligne").
 */
export type { DecodedChipData };

/**
 * Extrait EF.SOD + les DG (DG1 MRZ, DG2 photo, DG14/DG15 AA/CA) depuis `chipData`
 * (`SubmitVerificationDto.chipData`, produit par apps/mobile — voir
 * packages/emrtd-core/src/lds/chipDataEnvelope.ts pour le format d'échange exact et
 * apps/mobile/src/nfc/emrtdReader.ts pour la lecture NFC BAC/PACE qui l'alimente). Toute la suite
 * du pipeline (validation de chaîne, anomalies, face-match, verdict, persistance — voir
 * VerificationProcessor) consomme le résultat sans modification.
 */
export async function decodeChipData(chipDataBase64: string, documentType: DocumentType): Promise<DecodedChipData> {
  const envelope = parseChipDataEnvelope(chipDataBase64);
  return decodeChipDataEnvelope(envelope, documentType);
}
