import NfcManager, { NfcTech } from "react-native-nfc-manager";
import {
  deriveBacSessionKeys,
  performBacHandshake,
  readEmrtdChipData,
  BacAuthenticationError,
  ChipReaderError,
  type ApduTransceiver,
  type BacAccessKeyInput,
} from "@emrtd-verify/emrtd-core";

/** Informations lues sur la MRZ imprimée (zone visuelle), nécessaires pour établir BAC. */
export type MrzAccessKey = BacAccessKeyInput;

export interface EmrtdReadResult {
  dataGroups: Record<number, Uint8Array>;
  sod: Uint8Array;
  accessProtocolUsed: "BAC" | "PACE";
}

/** NFC absent de l'appareil ou désactivé dans les réglages — à distinguer d'un échec en cours de session (voir EmrtdReadResult ci-dessus et les exports de @emrtd-verify/emrtd-core pour les autres catégories). */
export class NfcUnavailableError extends Error {}

const DEFAULT_DATA_GROUPS = [1, 2, 14, 15]; // MRZ, photo, Chip Authentication (si présent), Active Authentication

/**
 * Adapte react-native-nfc-manager (`isoDepHandler.transceive`, commun iOS Core NFC / Android
 * IsoDep derrière une seule API JS — voir index.d.ts du paquet) à `ApduTransceiver`
 * (@emrtd-verify/emrtd-core) : le protocole BAC/messagerie sécurisée ne connaît que "des octets
 * qui partent, des octets qui reviennent", jamais react-native-nfc-manager directement — c'est ce
 * qui permet au même code protocolaire de tourner sans changement sur les deux plateformes.
 */
function createIsoDepTransceiver(): ApduTransceiver {
  return {
    async transceive(commandApdu: Uint8Array): Promise<Uint8Array> {
      const responseBytes = await NfcManager.isoDepHandler.transceive(Array.from(commandApdu));
      return Uint8Array.from(responseBytes);
    },
  };
}

/**
 * Établit un canal sécurisé BAC avec la puce (Doc 9303 Part 11 §4.3 — protocole implémenté et
 * testé dans @emrtd-verify/emrtd-core, voir nfc/{apdu,secureMessaging,bac,chipReader}.ts) et lit
 * le SOD + les groupes de données demandés. `dataGroupNumbers` par défaut : MRZ (DG1), photo
 * (DG2), et les clés Chip/Active Authentication (DG14/DG15) si présentes — ne demander que les DG
 * réellement nécessaires réduit le nombre d'échanges NFC (donc la durée de la lecture).
 *
 * Erreurs à distinguer côté appelant (UI) :
 * - `NfcUnavailableError` — NFC absent/désactivé, détecté AVANT d'ouvrir une session : proposer
 *   d'activer le NFC plutôt que de relancer la lecture.
 * - `BacAuthenticationError` (@emrtd-verify/emrtd-core) — clé BAC incorrecte (MRZ mal lue à
 *   l'OCR) ou authentification mutuelle échouée (document non conforme/falsifié) : proposer de
 *   rescanner la MRZ, PAS de simplement relancer la lecture NFC.
 * - `ChipReaderError` (@emrtd-verify/emrtd-core) — échec du protocole APDU après un BAC réussi
 *   (SELECT/READ BINARY), inclut un MAC de messagerie sécurisée invalide (transmission altérée) :
 *   relancer la lecture NFC est approprié (transitoire).
 * - Erreurs `NfcError.*` de react-native-nfc-manager (`SessionInvalidated`, `TagConnectionLost`,
 *   `UserCancel`, `Timeout`) — session NFC interrompue (téléphone éloigné du document, session
 *   expirée, annulation utilisateur) : relancer la lecture NFC est approprié.
 */
export async function readEmrtdChip(accessKey: MrzAccessKey, dataGroupNumbers: number[] = DEFAULT_DATA_GROUPS): Promise<EmrtdReadResult> {
  const isSupported = await NfcManager.isSupported();
  if (!isSupported) {
    throw new NfcUnavailableError("NFC non supporté par cet appareil");
  }
  const isEnabled = await NfcManager.isEnabled();
  if (!isEnabled) {
    throw new NfcUnavailableError("NFC désactivé — l'activer dans les réglages de l'appareil");
  }

  const documentKeys = await deriveBacSessionKeys(accessKey);

  await NfcManager.requestTechnology(NfcTech.IsoDep, { alertMessage: "Approchez le document du téléphone" });
  try {
    const transceiver = createIsoDepTransceiver();
    const { smKeys, ssc } = await performBacHandshake(transceiver, documentKeys);
    const { sod, dataGroups } = await readEmrtdChipData(transceiver, smKeys, ssc, dataGroupNumbers);
    return { dataGroups, sod, accessProtocolUsed: "BAC" };
  } finally {
    await NfcManager.cancelTechnologyRequest();
  }
}

export { BacAuthenticationError, ChipReaderError };
