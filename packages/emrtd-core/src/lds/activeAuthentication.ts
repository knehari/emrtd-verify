import { fromBER, Integer, type ObjectIdentifier, Sequence } from "asn1js";
import { PublicKeyInfo } from "pkijs";
import { ensurePkiEngine } from "../crypto/engine";
import { toArrayBuffer } from "../crypto/bytes";

/**
 * Active Authentication (Doc 9303 Part 11 §6) : le terminal envoie un défi aléatoire à la
 * puce (commande INTERNAL AUTHENTICATE), qui le signe avec sa clé privée — jamais exportée
 * de la puce — et renvoie la signature. Le terminal vérifie avec la clé publique portée par
 * DG15. Cette fonction ne couvre QUE la vérification cryptographique de la réponse (pure,
 * testable avec des clés synthétiques, sans matériel) ; l'envoi du défi et la réception de la
 * réponse via l'APDU NFC restent dans le périmètre non couvert de docs/roadmap.md Phase 4.
 *
 * Périmètre : ECDSA uniquement. Doc 9303 permet aussi RSA avec ISO/IEC 9796-2 scheme 1 (un
 * schéma à récupération de message, avec un formatage de redondance spécifique) — délibérément
 * non implémenté ici : c'est un schéma peu courant, sans bibliothèque de référence disponible
 * dans cet environnement pour valider une implémentation écrite depuis la spec, et une erreur
 * de padding y serait une faille de sécurité silencieuse (même principe que pour le protocole
 * APDU BAC/PACE — voir docs/roadmap.md). La plupart des eMRTD récents utilisent des clés EC
 * pour AA/CA (recommandation BSI TR-03110), ce qui couvre déjà le cas le plus courant.
 */

const ID_EC_PUBLIC_KEY_OID = "1.2.840.10045.2.1";

interface EcCurveInfo {
  webCryptoName: string;
  /** Longueur en octets de chaque composante (r, s) de la signature au format "raw" (IEEE P1363). */
  componentLength: number;
  hashAlgorithm: string;
}

const CURVE_OID_TO_INFO: Record<string, EcCurveInfo> = {
  "1.2.840.10045.3.1.7": { webCryptoName: "P-256", componentLength: 32, hashAlgorithm: "SHA-256" },
  "1.3.132.0.34": { webCryptoName: "P-384", componentLength: 48, hashAlgorithm: "SHA-384" },
  "1.3.132.0.35": { webCryptoName: "P-521", componentLength: 66, hashAlgorithm: "SHA-512" },
};

export interface ActiveAuthenticationVerification {
  /** false si la clé DG15 utilise un algorithme non couvert (ex. RSA-9796-2) — voir docstring du module. */
  supported: boolean;
  /** Signification uniquement quand supported === true. */
  valid: boolean;
  reason?: string;
}

/** Retire l'octet 0x00 de tête qu'ASN.1 DER ajoute à un INTEGER positif dont le bit de poids fort est posé. */
function stripDerIntegerPadding(bytes: Uint8Array): Uint8Array {
  return bytes.length > 1 && bytes[0] === 0x00 && (bytes[1] & 0x80) !== 0 ? bytes.slice(1) : bytes;
}

function padLeft(bytes: Uint8Array, length: number): Uint8Array {
  if (bytes.length > length) {
    throw new Error(`Composante de signature ECDSA trop longue (${bytes.length} > ${length} octets)`);
  }
  const padded = new Uint8Array(length);
  padded.set(bytes, length - bytes.length);
  return padded;
}

/**
 * Convertit une signature ECDSA au format DER (SEQUENCE { r INTEGER, s INTEGER } — convention
 * ISO/IEC 7816-8, celle attendue d'une puce eMRTD réelle) vers le format "raw" r‖s attendu par
 * SubtleCrypto.verify (IEEE P1363, Web Crypto ne supporte jamais DER directement pour ECDSA).
 */
export function derEcdsaSignatureToRaw(der: Uint8Array, componentLength: number): Uint8Array {
  const asn1 = fromBER(toArrayBuffer(der));
  if (asn1.offset === -1) {
    throw new Error("Signature ECDSA invalide : échec du décodage ASN.1 DER");
  }
  const [r, s] = (asn1.result as Sequence).valueBlock.value as [Integer, Integer];
  const rBytes = padLeft(stripDerIntegerPadding(new Uint8Array(r.valueBlock.valueHexView)), componentLength);
  const sBytes = padLeft(stripDerIntegerPadding(new Uint8Array(s.valueBlock.valueHexView)), componentLength);

  const raw = new Uint8Array(componentLength * 2);
  raw.set(rBytes, 0);
  raw.set(sBytes, componentLength);
  return raw;
}

export async function verifyActiveAuthenticationResponse(options: {
  /** SubjectPublicKeyInfo DER tel que porté par DG15 (Doc 9303 Part 10). */
  dg15PublicKeyDer: Uint8Array;
  /** Défi aléatoire envoyé à la puce (commande INTERNAL AUTHENTICATE). */
  challenge: Uint8Array;
  /** Réponse de la puce : signature ECDSA au format DER. */
  responseDer: Uint8Array;
}): Promise<ActiveAuthenticationVerification> {
  ensurePkiEngine();

  const spkiAsn1 = fromBER(toArrayBuffer(options.dg15PublicKeyDer));
  if (spkiAsn1.offset === -1) {
    return { supported: false, valid: false, reason: "Clé publique DG15 invalide (échec du décodage ASN.1)" };
  }
  const publicKeyInfo = new PublicKeyInfo({ schema: spkiAsn1.result });

  const algorithmOid = publicKeyInfo.algorithm.algorithmId;
  if (algorithmOid !== ID_EC_PUBLIC_KEY_OID) {
    return {
      supported: false,
      valid: false,
      reason: `Algorithme de clé DG15 non supporté (OID ${algorithmOid}) : seul ECDSA est implémenté ` +
        "(RSA/ISO-9796-2 scheme 1 non couvert, voir docstring de ce module et docs/roadmap.md).",
    };
  }

  const curveOid = (publicKeyInfo.algorithm.algorithmParams as ObjectIdentifier | undefined)?.valueBlock?.toString();
  const curve = curveOid ? CURVE_OID_TO_INFO[curveOid] : undefined;
  if (!curve) {
    return { supported: false, valid: false, reason: `Courbe EC non supportée pour AA (OID ${curveOid ?? "absent"})` };
  }

  let publicKey: CryptoKey;
  try {
    publicKey = await globalThis.crypto.subtle.importKey(
      "spki",
      toArrayBuffer(options.dg15PublicKeyDer),
      { name: "ECDSA", namedCurve: curve.webCryptoName },
      false,
      ["verify"],
    );
  } catch (error) {
    return { supported: false, valid: false, reason: `Import de la clé publique DG15 échoué : ${String(error)}` };
  }

  let rawSignature: Uint8Array;
  try {
    rawSignature = derEcdsaSignatureToRaw(options.responseDer, curve.componentLength);
  } catch (error) {
    return { supported: true, valid: false, reason: `Signature illisible : ${String(error)}` };
  }

  const valid = await globalThis.crypto.subtle.verify(
    { name: "ECDSA", hash: curve.hashAlgorithm },
    publicKey,
    toArrayBuffer(rawSignature),
    toArrayBuffer(options.challenge),
  );

  return { supported: true, valid };
}
