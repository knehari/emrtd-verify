import type { DataGroupHash } from "@emrtd-verify/emrtd-core";
import type { MrzFieldValidation } from "@emrtd-verify/emrtd-core";
import type { DocumentIdentity } from "@emrtd-verify/shared-types";

/**
 * Résultat de l'extraction des données de puce, prêt à alimenter la Passive Authentication
 * (PkiTrustService.validate), la détection d'anomalies et la comparaison faciale.
 */
export interface DecodedChipData {
  sodDer: Uint8Array;
  computedDataGroupHashes: DataGroupHash[];
  documentIdentity: DocumentIdentity;
  mrzValidation: MrzFieldValidation;
  /** Image DG2 (visage), si présente. */
  faceImage?: Uint8Array;
  activeOrChipAuthenticationPresent: boolean;
}

/**
 * Seul maillon du pipeline de vérification qui n'est PAS branché sur une implémentation réelle :
 * extraire EF.SOD et les DG (DG1 MRZ, DG2 photo, DG14/DG15 AA/CA) depuis le blob `chipData` brut
 * nécessite une session de lecture ICC authentifiée (APDU ISO/IEC 7816, BAC — Doc 9303 Part 11
 * §4 — ou PACE §9). `packages/emrtd-core` fournit déjà la dérivation des clés de session BAC
 * (bacKey.ts) et le décodage du SOD une fois obtenu (lds/sod.ts), mais pas la couche de
 * transport NFC/APDU elle-même : c'est la Phase 4 de docs/roadmap.md ("Mobile"), non couverte
 * par ce ticket. Toute la suite du pipeline (validation de chaîne, anomalies, face-match,
 * verdict, persistance — voir VerificationProcessor) est réellement branchée et s'exécutera
 * sans modification dès que cette fonction sera implémentée.
 */
export function decodeChipData(_chipDataBase64: string): DecodedChipData {
  throw new Error(
    "Non implémenté : extraction EF.SOD + DG depuis les données de puce brutes (nécessite une session " +
      "BAC/PACE authentifiée sur la puce, Doc 9303 Part 11 §4/§9). Voir docs/roadmap.md Phase 4.",
  );
}
