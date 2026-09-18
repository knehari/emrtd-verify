import NfcManager, { NfcTech } from "react-native-nfc-manager";

/** Informations lues sur la MRZ imprimée (zone visuelle), nécessaires pour établir BAC/PACE. */
export interface MrzAccessKey {
  documentNumber: string;
  dateOfBirth: string; // YYMMDD
  dateOfExpiry: string; // YYMMDD
}

export interface EmrtdReadResult {
  dataGroups: Record<number, Uint8Array>;
  sod: Uint8Array;
  accessProtocolUsed: "BAC" | "PACE";
}

/**
 * Établit un canal sécurisé avec la puce (PACE si supporté, sinon BAC — Doc 9303 Part 11)
 * et lit les groupes de données + le SOD. La dérivation de clé BAC/PACE et le protocole
 * bas niveau APDU restent à implémenter — voir docs/roadmap.md Phase 4. Cette interface fixe
 * le contrat consommé par l'écran de scan et par apps/api.
 */
export async function readEmrtdChip(_accessKey: MrzAccessKey): Promise<EmrtdReadResult> {
  await NfcManager.requestTechnology(NfcTech.IsoDep);
  try {
    throw new Error(
      "Non implémenté : dérivation de clé BAC/PACE et lecture APDU des DG/SOD. Voir docs/roadmap.md Phase 4.",
    );
  } finally {
    await NfcManager.cancelTechnologyRequest();
  }
}
