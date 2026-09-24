import { Platform } from "react-native";
import NfcManager, { NfcTech } from "react-native-nfc-manager";
import {
  establishSecureChannel,
  readEmrtdChipData,
  BacAuthenticationError,
  ChipReaderError,
  PaceAuthenticationError,
  PaceError,
  type ApduTransceiver,
  type BacAccessKeyInput,
} from "@emrtd-verify/emrtd-core";

/** Informations lues sur la MRZ imprimée (zone visuelle) : mot de passe de PACE comme de BAC. */
export type MrzAccessKey = BacAccessKeyInput;

export interface EmrtdReadResult {
  dataGroups: Record<number, Uint8Array>;
  sod: Uint8Array;
  accessProtocolUsed: "BAC" | "PACE";
}

/** NFC absent de l'appareil ou désactivé dans les réglages — à distinguer d'un échec en cours de session. */
export class NfcUnavailableError extends Error {}

export interface ReadEmrtdChipOptions {
  dataGroupNumbers?: number[];
  /** Progression de la lecture, de 0 à 1 (canal sécurisé établi ≈ 0,1, puis chaque fichier lu). */
  onProgress?: (fraction: number) => void;
}

const DEFAULT_DATA_GROUPS = [1, 2, 14, 15]; // MRZ, photo, Chip Authentication (si présent), Active Authentication

let nfcStarted: Promise<void> | undefined;

/**
 * Adapte react-native-nfc-manager (`isoDepHandler.transceive`, commun iOS Core NFC / Android
 * IsoDep — sur iOS il renvoie déjà données || SW1 || SW2) à `ApduTransceiver`
 * (@emrtd-verify/emrtd-core) : les protocoles PACE/BAC et la messagerie sécurisée ne connaissent
 * que "des octets qui partent, des octets qui reviennent".
 */
function createIsoDepTransceiver(): ApduTransceiver {
  return {
    async transceive(commandApdu: Uint8Array): Promise<Uint8Array> {
      const responseBytes = await NfcManager.isoDepHandler.transceive(Array.from(commandApdu));
      return Uint8Array.from(responseBytes);
    },
  };
}

function setIosMessage(message: string): void {
  if (Platform.OS === "ios") void NfcManager.setAlertMessageIOS(message).catch(() => undefined);
}

function iosFailureMessage(error: unknown): string {
  if (error instanceof PaceAuthenticationError || error instanceof BacAuthenticationError) {
    return "Accès refusé par la puce : vérifiez la zone MRZ saisie.";
  }
  return "Lecture interrompue — maintenez le document contre le haut du téléphone.";
}

/**
 * Lit la puce : EF.CardAccess, PACE (ou BAC en repli, voir `establishSecureChannel`), puis EF.SOD
 * et les groupes de données demandés sous messagerie sécurisée. `dataGroupNumbers` par défaut :
 * MRZ (DG1), photo (DG2) et les clés Chip/Active Authentication (DG14/DG15) si présentes.
 *
 * Erreurs à distinguer côté appelant (UI) :
 * - `NfcUnavailableError` — NFC absent/désactivé, détecté AVANT d'ouvrir une session.
 * - `PaceAuthenticationError` / `BacAuthenticationError` — clé MRZ refusée par la puce (MRZ mal
 *   lue ou saisie) ou document non authentique : proposer de rescanner la MRZ.
 * - `PaceError` (autre) / `ChipReaderError` — échec protocolaire ou transmission altérée (MAC de
 *   messagerie sécurisée invalide) : relancer la lecture NFC est approprié.
 * - Erreurs `NfcError.*` de react-native-nfc-manager (`UserCancel`, `Timeout`,
 *   `TagConnectionLost`…) — session interrompue : relancer la lecture NFC est approprié.
 */
export async function readEmrtdChip(accessKey: MrzAccessKey, options: ReadEmrtdChipOptions = {}): Promise<EmrtdReadResult> {
  const dataGroupNumbers = options.dataGroupNumbers ?? DEFAULT_DATA_GROUPS;
  nfcStarted ??= NfcManager.start().catch((error: unknown) => {
    nfcStarted = undefined;
    throw new NfcUnavailableError(`NFC indisponible sur cet appareil (${error instanceof Error ? error.message : String(error)})`);
  });
  await nfcStarted;
  if (!(await NfcManager.isSupported())) {
    throw new NfcUnavailableError("NFC non supporté par cet appareil");
  }
  if (!(await NfcManager.isEnabled())) {
    throw new NfcUnavailableError("NFC désactivé — l'activer dans les réglages de l'appareil");
  }

  // Sans détection après quelques secondes, c'est presque toujours le placement (antenne en haut du
  // dos de l'iPhone, coque épaisse) ou un document sans puce : on le dit dans la feuille système.
  const noTagHint = setTimeout(
    () => setIosMessage("Aucune puce détectée. Posez le haut du dos du téléphone à plat au centre du document, sans coque épaisse, et attendez 2 à 3 secondes."),
    12_000,
  );
  try {
    await NfcManager.requestTechnology(NfcTech.IsoDep, {
      alertMessage: "Posez le haut du téléphone sur le document et ne bougez plus.",
    });
  } finally {
    clearTimeout(noTagHint);
  }
  let failed = false;
  try {
    setIosMessage("Document détecté — connexion sécurisée…");
    const transceiver = createIsoDepTransceiver();
    const channel = await establishSecureChannel(transceiver, accessKey, {
      onProtocol: (protocol) => setIosMessage(`Connexion sécurisée (${protocol})…`),
    });
    options.onProgress?.(0.1);
    setIosMessage("Lecture de la puce… 10 %");

    const { sod, dataGroups } = await readEmrtdChipData(transceiver, channel.smKeys, channel.ssc, dataGroupNumbers, {
      onProgress: (filesRead, filesTotal) => {
        const fraction = 0.1 + 0.9 * (filesRead / filesTotal);
        options.onProgress?.(fraction);
        setIosMessage(`Lecture de la puce… ${Math.round(fraction * 100)} %`);
      },
    });
    setIosMessage("Lecture terminée ✓");
    return { dataGroups, sod, accessProtocolUsed: channel.protocol };
  } catch (error) {
    failed = true;
    if (Platform.OS === "ios") {
      await NfcManager.invalidateSessionWithErrorIOS(iosFailureMessage(error)).catch(() => undefined);
    }
    throw error;
  } finally {
    if (!failed || Platform.OS !== "ios") {
      await NfcManager.cancelTechnologyRequest().catch(() => undefined);
    }
  }
}

export { BacAuthenticationError, ChipReaderError, PaceAuthenticationError, PaceError };
