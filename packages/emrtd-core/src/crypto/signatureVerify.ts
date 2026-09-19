/**
 * Vérification de signature bas niveau (RSA/ECDSA) indépendante de pkijs' `SignedData.verify()`
 * et capable de courbes ECDSA que Web Crypto ne supporte pas nativement (notamment les courbes
 * Brainpool, RFC 5639, largement utilisées par les CSCA européennes conformément à BSI TR-03110).
 *
 * Contexte : Web Crypto (utilisé partout ailleurs dans ce module pour la portabilité navigateur/
 * mobile — voir engine.ts) ne connaît que P-256/P-384/P-521 pour ECDSA. Constaté sur un export
 * LDIF ICAO PKD réel : 12 des 28 Master List Signers réels échouaient la vérification de signature
 * avec "Incorrect type for ECDSA public key parameters" — leurs certificats utilisent Brainpool.
 *
 * Stratégie : tenter Web Crypto quand la courbe est supportée (chemin rapide, portable, inchangé
 * pour le cas majoritaire RSA/P-256/P-384/P-521) ; sinon, replier sur `node:crypto` (OpenSSL),
 * qui supporte Brainpool nativement — chargé dynamiquement pour ne jamais casser un bundler
 * navigateur/React Native qui ne fournit pas `node:crypto` (ce module n'est utilisé aujourd'hui
 * que côté serveur : synchronisation PKD dans apps/api, jamais par apps/mobile).
 */
import { fromBER, type ObjectIdentifier, type Sequence } from "asn1js";
import { PublicKeyInfo } from "pkijs";
import { toArrayBuffer } from "./bytes";
import { ensurePkiEngine } from "./engine";

interface RsaScheme {
  kind: "RSASSA-PKCS1-v1_5";
  hash: string;
}
interface EcdsaScheme {
  kind: "ECDSA";
  hash: string;
}
interface RsaPssScheme {
  kind: "RSA-PSS";
  hash: string;
  saltLength: number;
}
type SignatureScheme = RsaScheme | EcdsaScheme | RsaPssScheme;

/** OID -> nom de hachage Web Crypto, réutilisé pour digestAlgorithm (CMS) et RSASSA-PSS-params. */
export const DIGEST_ALGORITHM_OID_TO_WEBCRYPTO: Record<string, string> = {
  "1.3.14.3.2.26": "SHA-1",
  "2.16.840.1.101.3.4.2.4": "SHA-224",
  "2.16.840.1.101.3.4.2.1": "SHA-256",
  "2.16.840.1.101.3.4.2.2": "SHA-384",
  "2.16.840.1.101.3.4.2.3": "SHA-512",
};

/** OID d'algorithme de signature CMS/X.509 (combiné algo+hash) -> schéma de vérification. */
const SIGNATURE_ALGORITHM_OIDS: Record<string, SignatureScheme> = {
  "1.2.840.113549.1.1.5": { kind: "RSASSA-PKCS1-v1_5", hash: "SHA-1" },
  "1.2.840.113549.1.1.14": { kind: "RSASSA-PKCS1-v1_5", hash: "SHA-224" },
  "1.2.840.113549.1.1.11": { kind: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
  "1.2.840.113549.1.1.12": { kind: "RSASSA-PKCS1-v1_5", hash: "SHA-384" },
  "1.2.840.113549.1.1.13": { kind: "RSASSA-PKCS1-v1_5", hash: "SHA-512" },
  "1.2.840.10045.4.1": { kind: "ECDSA", hash: "SHA-1" },
  "1.2.840.10045.4.3.1": { kind: "ECDSA", hash: "SHA-224" },
  "1.2.840.10045.4.3.2": { kind: "ECDSA", hash: "SHA-256" },
  "1.2.840.10045.4.3.3": { kind: "ECDSA", hash: "SHA-384" },
  "1.2.840.10045.4.3.4": { kind: "ECDSA", hash: "SHA-512" },
};

/**
 * RFC 5652 §5.4 / RFC 3279 : certains émetteurs (constaté sur de vraies Master Lists ICAO PKD —
 * France notamment) placent l'OID "nu" rsaEncryption (sans hachage) dans SignerInfo.signatureAlgorithm
 * et laissent SignerInfo.digestAlgorithm porter le hachage réellement utilisé. RSASSA-PSS
 * (1.2.840.113549.1.1.10, RFC 4055 §3.1) est également constaté (Cameroun, Italie, Moldova, Mongolie,
 * Norvège) et porte ses propres paramètres (hachage, MGF1, longueur de sel).
 */
const RSA_ENCRYPTION_OID = "1.2.840.113549.1.1.1";
const RSA_PSS_OID = "1.2.840.113549.1.1.10";
const MGF1_OID = "1.2.840.113549.1.1.8";

function parsePssParams(paramsSequence: Sequence, fallbackHashOid: string | undefined): RsaPssScheme {
  // RSASSA-PSS-params ::= SEQUENCE { hashAlgorithm [0], maskGenAlgorithm [1], saltLength [2] INTEGER, trailerField [3] }
  // — tous DEFAULT SHA-1 si absents (RFC 4055), mais en pratique toujours présents explicitement.
  let hashOid = fallbackHashOid ?? "1.3.14.3.2.26";
  let mgfHashOid = hashOid;
  let saltLength = 20;
  for (const taggedValue of paramsSequence.valueBlock.value) {
    // Champs "[N] EXPLICIT" (RFC 4055) : le tag contextuel enveloppe un unique élément qui EST la
    // valeur réelle (AlgorithmIdentifier SEQUENCE, ou INTEGER) — pas la valeur directement.
    const tagNumber = taggedValue.idBlock.tagNumber;
    const wrapped = (taggedValue.valueBlock as unknown as { value: unknown[] }).value[0];
    if (tagNumber === 0) {
      hashOid = ((wrapped as Sequence).valueBlock.value[0] as ObjectIdentifier).valueBlock.toString();
    } else if (tagNumber === 1) {
      const mgfAlgorithm = wrapped as Sequence;
      const mgfParamsOid = (mgfAlgorithm.valueBlock.value[0] as ObjectIdentifier).valueBlock.toString();
      if (mgfParamsOid !== MGF1_OID) {
        throw new Error(`RSASSA-PSS : fonction de génération de masque non supportée (OID ${mgfParamsOid}, seul MGF1 est supporté)`);
      }
      const mgfHashAlgorithm = mgfAlgorithm.valueBlock.value[1] as Sequence;
      mgfHashOid = (mgfHashAlgorithm.valueBlock.value[0] as ObjectIdentifier).valueBlock.toString();
    } else if (tagNumber === 2) {
      saltLength = (wrapped as unknown as { valueBlock: { valueDec: number } }).valueBlock.valueDec;
    }
  }
  if (mgfHashOid !== hashOid) {
    throw new Error("RSASSA-PSS : hachage MGF1 différent du hachage principal, non supporté");
  }
  const hash = DIGEST_ALGORITHM_OID_TO_WEBCRYPTO[hashOid];
  if (!hash) {
    throw new Error(`RSASSA-PSS : algorithme de hachage non supporté (OID ${hashOid})`);
  }
  return { kind: "RSA-PSS", hash, saltLength };
}

/**
 * Résout le schéma de vérification effectif, y compris les cas où signatureAlgorithm seul ne
 * suffit pas (rsaEncryption "nu" : le hachage vient de digestAlgorithm ; RSASSA-PSS : ses propres
 * paramètres portent le hachage et la longueur de sel).
 */
export function resolveSignatureScheme(params: {
  signatureAlgorithmOid: string;
  signatureAlgorithmParams?: unknown;
  digestAlgorithmOid?: string;
}): SignatureScheme {
  const direct = SIGNATURE_ALGORITHM_OIDS[params.signatureAlgorithmOid];
  if (direct) return direct;

  if (params.signatureAlgorithmOid === RSA_ENCRYPTION_OID) {
    const hash = params.digestAlgorithmOid ? DIGEST_ALGORITHM_OID_TO_WEBCRYPTO[params.digestAlgorithmOid] : undefined;
    if (!hash) {
      throw new Error(`rsaEncryption sans hachage exploitable (digestAlgorithm OID ${params.digestAlgorithmOid ?? "absent"})`);
    }
    return { kind: "RSASSA-PKCS1-v1_5", hash };
  }

  if (params.signatureAlgorithmOid === RSA_PSS_OID) {
    if (!params.signatureAlgorithmParams) {
      throw new Error("RSASSA-PSS sans paramètres explicites, non supporté");
    }
    return parsePssParams(params.signatureAlgorithmParams as Sequence, params.digestAlgorithmOid);
  }

  throw new Error(`Algorithme de signature non supporté : OID ${params.signatureAlgorithmOid}`);
}

/** OID de courbe nommée -> nom Web Crypto (uniquement les courbes que Web Crypto supporte). */
const WEB_CRYPTO_CURVE_NAMES: Record<string, string> = {
  "1.2.840.10045.3.1.7": "P-256",
  "1.3.132.0.34": "P-384",
  "1.3.132.0.35": "P-521",
};

const EC_PUBLIC_KEY_OID = "1.2.840.10045.2.1";
const RSA_PUBLIC_KEY_OID = "1.2.840.113549.1.1.1";

export function signatureSchemeForOid(algorithmOid: string): SignatureScheme | undefined {
  return SIGNATURE_ALGORITHM_OIDS[algorithmOid];
}

/**
 * Extrait l'OID de courbe nommée d'une SubjectPublicKeyInfo EC quand elle en porte une (absent
 * pour RSA, ou pour une EC à paramètres explicites — SEQUENCE décrivant directement (p, a, b,
 * point de base, ordre) plutôt qu'un renvoi vers un OID standard, constaté sur une vraie Master
 * List ICAO PKD : forme rare mais valide, RFC 3279 §2.2.3).
 */
function ecNamedCurveOid(spki: PublicKeyInfo): string | undefined {
  if (spki.algorithm.algorithmId !== EC_PUBLIC_KEY_OID) return undefined;
  const params = spki.algorithm.algorithmParams;
  if (!params || params.constructor.name !== "ObjectIdentifier") return undefined;
  return (params as ObjectIdentifier).valueBlock.toString();
}

async function verifyEcdsaWithNodeCrypto(params: { spkiDer: ArrayBuffer; hash: string; signature: ArrayBuffer; signedData: ArrayBuffer }): Promise<boolean> {
  // Import dynamique : ce module reste chargeable (sans erreur) dans un bundler sans node:crypto
  // (navigateur/React Native) tant que ce chemin n'est pas effectivement exécuté. node:crypto
  // (OpenSSL) accepte directement le DER de la SubjectPublicKeyInfo quelle que soit la forme de
  // ses paramètres de courbe (OID nommé non reconnu par Web Crypto, ou paramètres explicites) —
  // pas besoin de faire nous-mêmes correspondre la courbe à une table connue.
  const nodeCrypto = await import("node:crypto");
  const publicKey = nodeCrypto.createPublicKey({ key: Buffer.from(params.spkiDer), format: "der", type: "spki" });
  const hashName = params.hash.toLowerCase().replace("-", "");
  return nodeCrypto.verify(hashName, Buffer.from(params.signedData), publicKey, Buffer.from(params.signature));
}

/**
 * Vérifie une signature RSA(-PSS)/ECDSA brute contre une clé publique (SubjectPublicKeyInfo DER),
 * en repliant sur node:crypto si Web Crypto ne supporte pas la courbe ECDSA du certificat.
 */
export async function verifyRawSignature(params: {
  spkiDer: Uint8Array;
  signatureAlgorithmOid: string;
  signatureAlgorithmParams?: unknown;
  digestAlgorithmOid?: string;
  signature: Uint8Array;
  signedData: Uint8Array;
}): Promise<boolean> {
  ensurePkiEngine();
  const scheme = resolveSignatureScheme(params);

  const spkiDer = toArrayBuffer(params.spkiDer);
  const signature = toArrayBuffer(params.signature);
  const signedData = toArrayBuffer(params.signedData);

  if (scheme.kind === "RSASSA-PKCS1-v1_5") {
    const key = await globalThis.crypto.subtle.importKey("spki", spkiDer, { name: "RSASSA-PKCS1-v1_5", hash: scheme.hash }, false, ["verify"]);
    return globalThis.crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, signature, signedData);
  }

  if (scheme.kind === "RSA-PSS") {
    const key = await globalThis.crypto.subtle.importKey("spki", spkiDer, { name: "RSA-PSS", hash: scheme.hash }, false, ["verify"]);
    return globalThis.crypto.subtle.verify({ name: "RSA-PSS", saltLength: scheme.saltLength }, key, signature, signedData);
  }

  // ECDSA : déterminer si Web Crypto connaît la courbe avant même d'essayer (évite de dépendre
  // du texte d'erreur, potentiellement instable d'une version de moteur JS à l'autre).
  const asn1 = fromBER(spkiDer);
  if (asn1.offset === -1) {
    throw new Error("SubjectPublicKeyInfo invalide : échec du décodage ASN.1");
  }
  const spki = new PublicKeyInfo({ schema: asn1.result });
  if (spki.algorithm.algorithmId === RSA_PUBLIC_KEY_OID) {
    throw new Error("Incohérence : clé RSA avec un algorithme de signature ECDSA");
  }
  const curveOid = ecNamedCurveOid(spki);
  const webCryptoCurve = curveOid ? WEB_CRYPTO_CURVE_NAMES[curveOid] : undefined;

  if (webCryptoCurve) {
    try {
      const key = await globalThis.crypto.subtle.importKey("spki", spkiDer, { name: "ECDSA", namedCurve: webCryptoCurve }, false, ["verify"]);
      return await globalThis.crypto.subtle.verify({ name: "ECDSA", hash: scheme.hash }, key, signature, signedData);
    } catch {
      // Repli sur node:crypto ci-dessous si Web Crypto échoue malgré une courbe a priori connue.
    }
  }

  return verifyEcdsaWithNodeCrypto({ spkiDer, hash: scheme.hash, signature, signedData });
}
