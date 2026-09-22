import { computeCheckDigit } from "./checkDigit";
import { toArrayBuffer } from "../crypto/bytes";

/** Données lues sur la MRZ imprimée, nécessaires à l'établissement du canal BAC. */
export interface BacAccessKeyInput {
  /** Sans caractères de bourrage '<' ; ils sont ajoutés automatiquement si besoin. */
  documentNumber: string;
  dateOfBirth: string; // YYMMDD
  dateOfExpiry: string; // YYMMDD
}

export interface BacSessionKeys {
  /** Clé 3DES à 2 clés (K1||K2, 16 octets) dérivée avec le compteur 0x00000001. */
  kEnc: Uint8Array;
  /** Clé 3DES à 2 clés (K1||K2, 16 octets) dérivée avec le compteur 0x00000002. */
  kMac: Uint8Array;
}

function padDocumentNumber(documentNumber: string): string {
  return documentNumber.padEnd(9, "<").slice(0, 9);
}

/**
 * MRZ_information (Doc 9303 Part 11 §4.3.1 / Appendix D.2) : numéro de document (9, bourré),
 * son chiffre de contrôle, date de naissance, son chiffre de contrôle, date d'expiration,
 * son chiffre de contrôle — 24 caractères, entrée du calcul de Kseed.
 */
export function buildMrzInformation(input: BacAccessKeyInput): string {
  const documentNumberField = padDocumentNumber(input.documentNumber);
  return (
    documentNumberField +
    String(computeCheckDigit(documentNumberField)) +
    input.dateOfBirth +
    String(computeCheckDigit(input.dateOfBirth)) +
    input.dateOfExpiry +
    String(computeCheckDigit(input.dateOfExpiry))
  );
}

/**
 * SHA-1 via le Web Crypto global (`globalThis.crypto.subtle`) plutôt que `node:crypto` :
 * disponible nativement depuis Node 20, dans tout navigateur, et polyfillable en React
 * Native — condition pour que ce module reste réellement réutilisable côté mobile
 * (voir docs/architecture.md). SHA-1 n'est plus recommandé pour la signature, mais reste
 * l'algorithme imposé ici par Doc 9303 Part 11 Appendix D.1 pour la dérivation de clé BAC.
 */
async function sha1(data: Uint8Array): Promise<Uint8Array> {
  if (typeof globalThis.crypto?.subtle === "undefined") {
    throw new Error(
      "Web Crypto API indisponible (globalThis.crypto.subtle) : requis pour la dérivation de clé BAC.",
    );
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-1", toArrayBuffer(data));
  return new Uint8Array(digest);
}

/** Kseed = 16 premiers octets de SHA-1(MRZ_information) — Doc 9303 Part 11 Appendix D.2. */
export async function deriveBacSeed(input: BacAccessKeyInput): Promise<Uint8Array> {
  const mrzInformation = buildMrzInformation(input);
  const digest = await sha1(new TextEncoder().encode(mrzInformation));
  return digest.subarray(0, 16);
}

function popcount8(byte: number): number {
  let count = 0;
  let value = byte;
  while (value) {
    count += value & 1;
    value >>= 1;
  }
  return count;
}

/** Ajuste le bit de poids faible de chaque octet pour obtenir une parité impaire (clé DES). */
function setOddParityByte(byte: number): number {
  const onesInTop7Bits = popcount8(byte >> 1);
  const parityBit = onesInTop7Bits % 2 === 0 ? 1 : 0;
  return (byte & 0xfe) | parityBit;
}

/**
 * Fonction de dérivation de clé — Doc 9303 Part 11 Appendix D.1 : K = MSB16(SHA-1(Kseed || c)),
 * ajustée en parité DES. Algorithme identique à celui de référence implémentations largement
 * déployées (ex. pypassport `doc9303/bac.py`). Exportée (pas seulement utilisée pour KEnc/KMac
 * ci-dessous) : c'est la MÊME fonction générique de dérivation qui sert aussi, avec un seed
 * différent (Kifd XOR Kic), à dériver les clés de session post-authentification KSenc/KSmac —
 * voir nfc/bac.ts. Éviter de la dupliquer réduit le risque de divergence entre les deux usages.
 */
export async function deriveKeyFromSeed(seed: Uint8Array, counter: 1 | 2): Promise<Uint8Array> {
  const material = new Uint8Array(seed.length + 4);
  material.set(seed, 0);
  material.set([0, 0, 0, counter], seed.length);

  const hash = await sha1(material);
  const key = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    key[i] = setOddParityByte(hash[i]);
  }
  return key;
}

/** Dérive les clés de session BAC (KEnc, KMac) à partir des données lues sur la MRZ imprimée. */
export async function deriveBacSessionKeys(input: BacAccessKeyInput): Promise<BacSessionKeys> {
  const seed = await deriveBacSeed(input);
  const [kEnc, kMac] = await Promise.all([deriveKeyFromSeed(seed, 1), deriveKeyFromSeed(seed, 2)]);
  return { kEnc, kMac };
}
