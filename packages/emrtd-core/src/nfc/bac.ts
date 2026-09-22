import { buildCommandApdu, formatStatusWord, isSuccess, parseResponseApdu } from "./apdu";
import type { SecureMessagingKeys } from "./secureMessaging";
import { computeRetailMac, constantTimeEquals, padIso9797Method2 } from "../crypto/retailMac";
import { tripleDesCbcDecrypt, tripleDesCbcEncrypt } from "../crypto/tripleDes";
import { deriveKeyFromSeed, type BacSessionKeys } from "../mrz/bacKey";

/**
 * Établissement du canal BAC (Doc 9303 Part 11 §4.3.3/§4.3.4) : GET CHALLENGE, construction/envoi
 * de MUTUAL AUTHENTICATE, vérification de l'authentification mutuelle, dérivation des clés de
 * session. Double confirmation indépendante :
 * - Structure : suite de conformité officielle ETSI (STF400, `ePassport-master.zip` fourni par
 *   l'utilisateur, `ePassport_Functions.ttcn` fonction `f_basicAccessControl`) — S envoyé par le
 *   lecteur = RND.IFD||RND.IC||Kifd, R renvoyé par la puce = RND.IC||RND.IFD||Kic,
 *   Kseed' = Kifd XOR Kic, SSC = 4 octets de poids faible de RND.IC || 4 octets de poids faible
 *   de RND.IFD.
 * - Byte-exact : exemple travaillé officiel ICAO Doc 9303 Part 11 Appendix D.2/D.3 (pages
 *   scannées fournies par l'utilisateur) — E_IFD = 3DES-CBC(KEnc, RND.IFD||RND.IC||K.IFD)
 *   reproduit EXACTEMENT l'exemple documenté (RND.IC=4608F91988702212, K.IFD confirmé, KEnc
 *   dérivé de la MRZ de référence) — voir bac.test.ts "exemple travaillé officiel ICAO" et
 *   bacKey.test.ts.
 * Validé aussi par une simulation de puce indépendante (bac.test.ts), qui exerce en particulier
 * les propriétés de sécurité (rejet sur MAC invalide, rejet sur échec de l'authentification
 * mutuelle) — pas seulement le chemin nominal.
 */

/** Puce ISO 7816 générique — seule dépendance envers le matériel/la plateforme (voir apps/mobile/src/nfc/emrtdReader.ts pour l'implémentation react-native-nfc-manager). */
export interface ApduTransceiver {
  transceive(commandApdu: Uint8Array): Promise<Uint8Array>;
}

export interface BacHandshakeResult {
  smKeys: SecureMessagingKeys;
  /** SSC initial pour la première commande protégée (voir secureMessaging.ts). */
  ssc: Uint8Array;
}

/** Échec du protocole BAC — distingue explicitement l'échec de MUTUAL AUTHENTICATE (clé issue
 * d'une MRZ mal lue, document non conforme) d'une falsification détectée (MAC ou authentification
 * mutuelle invalide), pour que l'appelant puisse réagir différemment (voir emrtdReader.ts). */
export class BacAuthenticationError extends Error {}

const ZERO_IV = new Uint8Array(8);

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

function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

async function generateRandomBytes(length: number): Promise<Uint8Array> {
  if (typeof globalThis.crypto?.getRandomValues === "undefined") {
    throw new Error(
      "crypto.getRandomValues indisponible : requis pour générer RND.IFD/K.IFD. Sur React Native, " +
        "importer `react-native-get-random-values` avant tout appel à performBacHandshake (voir apps/mobile).",
    );
  }
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

async function sendAndCheck(transceiver: ApduTransceiver, apdu: Uint8Array, step: string) {
  const raw = await transceiver.transceive(apdu);
  const response = parseResponseApdu(raw);
  if (!isSuccess(response)) {
    throw new BacAuthenticationError(`${step} a échoué : SW=${formatStatusWord(response)}`);
  }
  return response;
}

/**
 * Exécute le handshake BAC complet sur une session NFC déjà ouverte. `documentKeys` sont KEnc/KMac
 * dérivées de la MRZ (bacKey.ts `deriveBacSessionKeys`) — malgré son nom historique
 * `BacSessionKeys`, ce sont les clés DOCUMENT (statiques), pas les clés de SESSION retournées ici.
 */
export async function performBacHandshake(transceiver: ApduTransceiver, documentKeys: BacSessionKeys): Promise<BacHandshakeResult> {
  // 1. GET CHALLENGE — la puce renvoie RND.IC (8 octets), un nonce frais qu'elle seule connaît à l'avance.
  const getChallengeResponse = await sendAndCheck(transceiver, buildCommandApdu({ cla: 0x00, ins: 0x84, p1: 0x00, p2: 0x00, le: 8 }), "GET CHALLENGE");
  const rndIc = getChallengeResponse.data;
  if (rndIc.length !== 8) {
    throw new BacAuthenticationError(`RND.IC de longueur inattendue (${rndIc.length} au lieu de 8) — réponse GET CHALLENGE malformée`);
  }

  // 2. Le lecteur génère son propre nonce (RND.IFD) et sa propre clé aléatoire (Kifd).
  const rndIfd = await generateRandomBytes(8);
  const kIfd = await generateRandomBytes(16);

  // 3. S = RND.IFD || RND.IC || Kifd (32 octets, déjà multiple de 8 — aucun padding requis pour
  // le chiffrement, mais le retail MAC est TOUJOURS calculé sur une entrée paddée, même alignée).
  const s = concatBytes(rndIfd, rndIc, kIfd);
  const eIfd = tripleDesCbcEncrypt(documentKeys.kEnc, ZERO_IV, s);
  const mIfd = computeRetailMac(documentKeys.kMac, padIso9797Method2(eIfd));

  // 4. MUTUAL AUTHENTICATE : envoie EIFD||MIFD (40 octets), attend EIC||MIC (40 octets) en retour.
  const mutualAuthApdu = buildCommandApdu({ cla: 0x00, ins: 0x82, p1: 0x00, p2: 0x00, data: concatBytes(eIfd, mIfd), le: 40 });
  const mutualAuthResponse = await sendAndCheck(transceiver, mutualAuthApdu, "MUTUAL AUTHENTICATE");
  if (mutualAuthResponse.data.length !== 40) {
    throw new BacAuthenticationError(`Réponse MUTUAL AUTHENTICATE de longueur inattendue (${mutualAuthResponse.data.length} au lieu de 40)`);
  }
  const eIc = mutualAuthResponse.data.subarray(0, 32);
  const mIcReceived = mutualAuthResponse.data.subarray(32, 40);

  // 5. Vérifie le MAC AVANT tout déchiffrement — jamais faire confiance à un texte déchiffré non authentifié.
  const mIcExpected = computeRetailMac(documentKeys.kMac, padIso9797Method2(eIc));
  if (!constantTimeEquals(mIcExpected, mIcReceived)) {
    throw new BacAuthenticationError("MAC de la réponse MUTUAL AUTHENTICATE invalide — document non authentique ou clé BAC incorrecte (MRZ mal lue ?)");
  }

  // 6. Déchiffre EIC → RND.IC'||RND.IFD'||Kic.
  const decrypted = tripleDesCbcDecrypt(documentKeys.kEnc, ZERO_IV, eIc);
  const rndIcEchoed = decrypted.subarray(0, 8);
  const rndIfdEchoed = decrypted.subarray(8, 16);
  const kIc = decrypted.subarray(16, 32);

  // 7. Authentification MUTUELLE stricte : la puce doit renvoyer EXACTEMENT les nonces échangés —
  // sinon c'est soit une puce qui ne détient pas la bonne clé document, soit une tentative de rejeu.
  if (!constantTimeEquals(rndIcEchoed, rndIc)) {
    throw new BacAuthenticationError("RND.IC renvoyé par la puce ne correspond pas au défi envoyé — authentification mutuelle échouée");
  }
  if (!constantTimeEquals(rndIfdEchoed, rndIfd)) {
    throw new BacAuthenticationError("RND.IFD renvoyé par la puce ne correspond pas — authentification mutuelle échouée (rejeu ou usurpation possible)");
  }

  // 8. Clés de session : Kseed' = Kifd XOR Kic, puis même KDF que pour les clés document (Appendix D.1).
  const sessionSeed = xorBytes(kIfd, kIc);
  const [ksEnc, ksMac] = await Promise.all([deriveKeyFromSeed(sessionSeed, 1), deriveKeyFromSeed(sessionSeed, 2)]);

  // 9. SSC initial = 4 octets de poids faible de RND.IC || 4 octets de poids faible de RND.IFD.
  const ssc = concatBytes(rndIc.subarray(4, 8), rndIfd.subarray(4, 8));

  return { smKeys: { ksEnc, ksMac }, ssc };
}
