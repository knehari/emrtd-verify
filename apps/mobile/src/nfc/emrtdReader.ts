import NfcManager, { NfcTech } from "react-native-nfc-manager";
import { deriveBacSessionKeys, type BacAccessKeyInput, type BacSessionKeys } from "@emrtd-verify/emrtd-core";

/** Informations lues sur la MRZ imprimée (zone visuelle), nécessaires pour établir BAC/PACE. */
export type MrzAccessKey = BacAccessKeyInput;

export interface EmrtdReadResult {
  dataGroups: Record<number, Uint8Array>;
  sod: Uint8Array;
  accessProtocolUsed: "BAC" | "PACE";
}

/**
 * Établit un canal sécurisé avec la puce (PACE si supporté, sinon BAC — Doc 9303 Part 11)
 * et lit les groupes de données + le SOD.
 *
 * État actuel : la dérivation des clés de session BAC (KEnc/KMac) est réelle et testée
 * (packages/emrtd-core/src/mrz/bacKey.ts). Ce qui reste à implémenter est le protocole
 * bas niveau sur la puce elle-même — GET CHALLENGE, construction de la commande MUTUAL
 * AUTHENTICATE (chiffrement 3DES-CBC + retail MAC ISO/IEC 9797-1 MAC Algorithm 3 avec
 * KEnc/KMac), dérivation des clés de session post-authentification (Doc 9303 Part 11
 * §4.3.3/§4.3.4), puis la messagerie sécurisée pour lire chaque DG et le SOD via
 * NfcManager.transceive(). Volontairement non implémenté ici plutôt qu'à moitié : ce
 * protocole n'est vérifiable qu'avec un vrai document et un vrai lecteur NFC, absents de
 * cet environnement — l'implémenter à l'aveugle risquerait d'introduire une faille de
 * sécurité de messagerie chiffrée non détectable par les tests. Voir docs/roadmap.md
 * Phase 4 (issue GitHub dédiée) : c'est la prochaine étape, à valider sur device réel.
 */
export async function readEmrtdChip(accessKey: MrzAccessKey): Promise<EmrtdReadResult> {
  const sessionKeys: BacSessionKeys = await deriveBacSessionKeys(accessKey);

  await NfcManager.requestTechnology(NfcTech.IsoDep);
  try {
    throw new Error(
      "Non implémenté : protocole APDU BAC/PACE (GET CHALLENGE, MUTUAL AUTHENTICATE, messagerie sécurisée) " +
        "et lecture des DG/SOD sur la puce. Clés de session dérivées avec succès ; voir docs/roadmap.md Phase 4.",
    );
  } finally {
    // Les clés de session ne doivent jamais fuiter au-delà de cette portée (voir
    // docs/gdpr-compliance.md "Minimisation") ; référencées ici pour satisfaire le typage
    // en attendant le branchement de la messagerie sécurisée (Phase 4).
    void sessionKeys;
    await NfcManager.cancelTechnologyRequest();
  }
}
