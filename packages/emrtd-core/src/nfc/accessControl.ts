import { buildCommandApdu, formatStatusWord, isSuccess, parseResponseApdu } from "./apdu";
import { performBacHandshake, BacAuthenticationError, type ApduTransceiver } from "./bac";
import { EMRTD_APPLICATION_AID } from "./chipReader";
import { PaceAuthenticationError, PaceError, parsePaceInfos, performPace, selectSupportedPaceInfo, type PaceInfo, type PaceOptions } from "./pace";
import type { SecureMessagingKeys } from "./secureMessaging";
import { deriveBacSessionKeys, type BacAccessKeyInput } from "../mrz/bacKey";

/**
 * Contrôle d'accès à la puce (Doc 9303 Part 11 §4.2) : PACE si EF.CardAccess l'annonce dans une
 * variante prise en charge, sinon BAC — l'ordre imposé par Doc 9303 aux systèmes d'inspection
 * compatibles PACE.
 */

export interface SecureChannel {
  smKeys: SecureMessagingKeys;
  ssc: Uint8Array;
  protocol: "PACE" | "BAC";
  paceInfo?: PaceInfo;
}

const EF_CARD_ACCESS_SFI = 0x1c;

async function send(transceiver: ApduTransceiver, apdu: Uint8Array) {
  return parseResponseApdu(await transceiver.transceive(apdu));
}

/** Fin de fichier atteinte avant Le (SW 6282) : les données renvoyées restent valides. */
function isReadOk(response: { sw1: number; sw2: number }): boolean {
  return isSuccess(response) || (response.sw1 === 0x62 && response.sw2 === 0x82);
}

/**
 * Lit EF.CardAccess (MF, SFI 0x1C, lecture libre) — `undefined` si la puce n'en a pas (document
 * BAC uniquement). Sélectionne d'abord le MF par son FID 3F00 : sur iOS, Core NFC a déjà
 * sélectionné l'application eMRTD à la détection, et certaines puces ne résolvent pas le SFI hors
 * du MF. Les erreurs de transport (document éloigné…) remontent telles quelles.
 */
export async function readCardAccess(transceiver: ApduTransceiver): Promise<Uint8Array | undefined> {
  await send(transceiver, buildCommandApdu({ cla: 0x00, ins: 0xa4, p1: 0x00, p2: 0x0c, data: Uint8Array.of(0x3f, 0x00) }));
  const first = await send(transceiver, buildCommandApdu({ cla: 0x00, ins: 0xb0, p1: 0x80 | EF_CARD_ACCESS_SFI, p2: 0x00, le: 0 }));
  if (!isReadOk(first) || first.data.length < 2) return undefined;

  // EF.CardAccess dépasse rarement 256 octets ; sinon on complète d'après la longueur DER annoncée.
  const lengthByte = first.data[1];
  let total = lengthByte + 2;
  if (lengthByte === 0x81) total = first.data[2] + 3;
  else if (lengthByte === 0x82) total = ((first.data[2] << 8) | first.data[3]) + 4;
  const content = new Uint8Array(total);
  content.set(first.data.subarray(0, total));
  for (let offset = Math.min(first.data.length, total); offset < total; ) {
    const next = await send(
      transceiver,
      buildCommandApdu({ cla: 0x00, ins: 0xb0, p1: (offset >> 8) & 0x7f, p2: offset & 0xff, le: Math.min(total - offset, 0xdf) }),
    );
    if (!isReadOk(next) || next.data.length === 0) return undefined;
    content.set(next.data.subarray(0, total - offset), offset);
    offset += next.data.length;
  }
  return content;
}

/** SELECT de l'application eMRTD en clair — préalable à BAC (les clés BAC sont propres à l'application). */
export async function selectEmrtdApplication(transceiver: ApduTransceiver): Promise<void> {
  const response = await send(transceiver, buildCommandApdu({ cla: 0x00, ins: 0xa4, p1: 0x04, p2: 0x0c, data: EMRTD_APPLICATION_AID }));
  if (!isSuccess(response)) {
    throw new BacAuthenticationError(`SELECT de l'application eMRTD refusé : SW=${formatStatusWord(response)}`);
  }
}

export interface EstablishChannelOptions {
  pace?: PaceOptions;
  /** Appelé au moment de choisir le protocole (message de progression côté UI). */
  onProtocol?: (protocol: "PACE" | "BAC") => void;
}

/**
 * Établit le canal sécurisé : PACE (avec la clé MRZ) quand la puce le propose, repli sur BAC si
 * PACE n'est pas proposé, pas pris en charge ici, ou échoue pour une raison autre qu'un mauvais
 * mot de passe. Un mot de passe refusé par PACE (`PaceAuthenticationError`) n'est PAS rejoué en
 * BAC : la MRZ est fausse, BAC échouerait pareil. Si BAC échoue aussi après un échec PACE, c'est
 * l'erreur PACE qui est remontée (la puce annonçait PACE, c'est l'information utile).
 */
export async function establishSecureChannel(
  transceiver: ApduTransceiver,
  accessKey: BacAccessKeyInput,
  options: EstablishChannelOptions = {},
): Promise<SecureChannel> {
  const cardAccess = await readCardAccess(transceiver);
  let paceInfo: PaceInfo | undefined;
  if (cardAccess) {
    try {
      paceInfo = selectSupportedPaceInfo(parsePaceInfos(cardAccess));
    } catch (error) {
      if (!(error instanceof PaceError)) throw error;
    }
  }

  let paceFailure: PaceError | undefined;
  if (paceInfo) {
    options.onProtocol?.("PACE");
    try {
      const result = await performPace(transceiver, { kind: "mrz", accessKey }, paceInfo, options.pace);
      return { ...result, protocol: "PACE" };
    } catch (error) {
      if (error instanceof PaceAuthenticationError || !(error instanceof PaceError)) throw error;
      paceFailure = error;
    }
  }

  options.onProtocol?.("BAC");
  try {
    await selectEmrtdApplication(transceiver);
    const { smKeys, ssc } = await performBacHandshake(transceiver, await deriveBacSessionKeys(accessKey));
    return { smKeys, ssc, protocol: "BAC" };
  } catch (error) {
    if (paceFailure && error instanceof BacAuthenticationError) throw paceFailure;
    throw error;
  }
}
