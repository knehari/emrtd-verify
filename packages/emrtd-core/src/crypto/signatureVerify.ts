/**
 * Vérification de signature bas niveau (RSA PKCS#1 v1.5, RSA-PSS, ECDSA) pour CMS (SOD, Master
 * Lists) et X.509, indépendante de pkijs' `SignedData.verify()`/`Certificate.verify()` et de Web
 * Crypto. Ce module résout le schéma effectif à partir des OID (y compris rsaEncryption "nu" +
 * digestAlgorithm, RSASSA-PSS-params, ecdsa-plain BSI) ; le calcul lui-même est fait en JavaScript
 * pur par pureVerify.ts — seule implémentation qui tourne à l'identique sur Node et React Native
 * (Hermes n'a pas `crypto.subtle`), avec Brainpool et les courbes explicites des CSCA européennes.
 */
import type { ObjectIdentifier, Sequence } from "asn1js";
import { verifySignaturePure } from "./pureVerify";

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
  // ecdsa-plain-* (BSI TR-03111 §5.2.1) : signature r||s au lieu de DER, gérée par pureVerify.ts.
  "0.4.0.127.0.7.1.1.4.1.1": { kind: "ECDSA", hash: "SHA-1" },
  "0.4.0.127.0.7.1.1.4.1.2": { kind: "ECDSA", hash: "SHA-224" },
  "0.4.0.127.0.7.1.1.4.1.3": { kind: "ECDSA", hash: "SHA-256" },
  "0.4.0.127.0.7.1.1.4.1.4": { kind: "ECDSA", hash: "SHA-384" },
  "0.4.0.127.0.7.1.1.4.1.5": { kind: "ECDSA", hash: "SHA-512" },
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

export function signatureSchemeForOid(algorithmOid: string): SignatureScheme | undefined {
  return SIGNATURE_ALGORITHM_OIDS[algorithmOid];
}

export type EcdsaFallbackVerifier = (params: {
  spkiDer: ArrayBuffer;
  hash: string;
  signature: ArrayBuffer;
  signedData: ArrayBuffer;
}) => Promise<boolean>;

/**
 * Conservé pour compatibilité avec packages/pki-trust/src/nodeCryptoFallback.ts : sans effet depuis
 * que toutes les vérifications passent par pureVerify.ts (qui gère Brainpool et les courbes
 * explicites sans OpenSSL).
 */
export function registerEcdsaFallbackVerifier(_verifier: EcdsaFallbackVerifier): void {}

/** Vérifie une signature RSA(-PSS)/ECDSA contre une clé publique (SubjectPublicKeyInfo DER). */
export async function verifyRawSignature(params: {
  spkiDer: Uint8Array;
  signatureAlgorithmOid: string;
  signatureAlgorithmParams?: unknown;
  digestAlgorithmOid?: string;
  signature: Uint8Array;
  signedData: Uint8Array;
}): Promise<boolean> {
  const scheme = resolveSignatureScheme(params);
  // JavaScript pur (pureVerify.ts) pour tous les cas : Web Crypto n'existe pas sur React Native, ne
  // connaît pas Brainpool ni les courbes explicites, et attend des signatures ECDSA "brutes" alors
  // que X.509/CMS les encodent en DER — même code, même résultat sur serveur et sur mobile.
  return verifySignaturePure({ spkiDer: params.spkiDer, scheme, signature: params.signature, signedData: params.signedData });
}
