/**
 * Signature ECDSA P-256 d'un objet JSON-sérialisable, avec sérialisation canonique (clés triées
 * récursivement) pour que la signature soit reproductible indépendamment de l'ordre d'insertion
 * des propriétés en JavaScript. Générique — pas spécifique à `VerificationResult` — utilisé par
 * apps/api pour signer les résultats de vérification et le bundle CSCA hors ligne (voir
 * docs/kyc-integration.md "Vérification de la signature"), et par apps/mobile pour vérifier ce
 * dernier localement (voir docs/pki-trust-model.md "Vérification hors ligne").
 *
 * P-256 (pas Brainpool) : cette clé est générée et détenue par la plateforme elle-même (jamais un
 * certificat tiers dont on ne choisit pas l'algorithme), donc aucune raison de sortir de ce que
 * Web Crypto supporte nativement.
 */
import { base64ToBytes, bytesToBase64 } from "./base64";
import { toArrayBuffer } from "./bytes";
import { verifySignaturePure } from "./pureVerify";

/** Sérialise `value` en JSON avec les clés d'objet triées récursivement (ordre des tableaux préservé). */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  return toArrayBuffer(base64ToBytes(base64));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return bytesToBase64(new Uint8Array(buffer));
}

export async function importEcdsaP256PrivateKeyFromPkcs8Base64(pkcs8Base64: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey("pkcs8", base64ToArrayBuffer(pkcs8Base64), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

export async function importEcdsaP256PublicKeyFromSpkiBase64(spkiBase64: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey("spki", base64ToArrayBuffer(spkiBase64), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
}

/** Signe la sérialisation canonique de `payload` — renvoie la signature encodée en base64. */
export async function signJsonPayload(payload: unknown, privateKey: CryptoKey): Promise<string> {
  const data = new TextEncoder().encode(canonicalJsonStringify(payload));
  const signature = await globalThis.crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, data);
  return arrayBufferToBase64(signature);
}

/** Vérifie qu'une signature base64 correspond bien à la sérialisation canonique de `payload`. */
export async function verifyJsonPayloadSignature(payload: unknown, signatureBase64: string, publicKey: CryptoKey): Promise<boolean> {
  const data = new TextEncoder().encode(canonicalJsonStringify(payload));
  return globalThis.crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, base64ToArrayBuffer(signatureBase64), data);
}

/**
 * Même vérification que `verifyJsonPayloadSignature`, en JavaScript pur (@noble) à partir de la clé
 * SPKI en base64 — pour React Native/Hermes, qui n'a pas Web Crypto (`crypto.subtle`). La signature
 * Web Crypto ECDSA est au format r‖s (IEEE P1363), accepté tel quel par `verifySignaturePure`.
 */
export function verifyJsonPayloadSignatureWithSpki(payload: unknown, signatureBase64: string, spkiBase64: string): boolean {
  try {
    return verifySignaturePure({
      spkiDer: base64ToBytes(spkiBase64),
      scheme: { kind: "ECDSA", hash: "SHA-256" },
      signature: base64ToBytes(signatureBase64),
      signedData: new TextEncoder().encode(canonicalJsonStringify(payload)),
    });
  } catch {
    return false;
  }
}
