/**
 * Signature ECDSA P-256 d'un objet JSON-sérialisable, avec sérialisation canonique (clés triées
 * récursivement) pour que la signature soit reproductible indépendamment de l'ordre d'insertion
 * des propriétés en JavaScript. Générique — pas spécifique à `VerificationResult` — utilisé par
 * apps/api pour signer les résultats de vérification (voir docs/kyc-integration.md "Vérification
 * de la signature").
 *
 * P-256 (pas Brainpool) : cette clé est générée et détenue par la plateforme elle-même (jamais un
 * certificat tiers dont on ne choisit pas l'algorithme), donc aucune raison de sortir de ce que
 * Web Crypto supporte nativement — reste portable navigateur/mobile si un jour utile côté client.
 */

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
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
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
