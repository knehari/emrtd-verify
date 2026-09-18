import { createHash } from "node:crypto";
import { computeCheckDigit } from "./checkDigit";

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

/** Kseed = 16 premiers octets de SHA-1(MRZ_information) — Doc 9303 Part 11 Appendix D.2. */
export function deriveBacSeed(input: BacAccessKeyInput): Uint8Array {
  const mrzInformation = buildMrzInformation(input);
  const digest = createHash("sha1").update(mrzInformation, "ascii").digest();
  return new Uint8Array(digest.subarray(0, 16));
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
 * déployées (ex. pypassport `doc9303/bac.py`).
 */
function deriveDesKey(seed: Uint8Array, counter: 1 | 2): Uint8Array {
  const material = new Uint8Array(seed.length + 4);
  material.set(seed, 0);
  material.set([0, 0, 0, counter], seed.length);

  const hash = createHash("sha1").update(material).digest();
  const key = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    key[i] = setOddParityByte(hash[i]);
  }
  return key;
}

/** Dérive les clés de session BAC (KEnc, KMac) à partir des données lues sur la MRZ imprimée. */
export function deriveBacSessionKeys(input: BacAccessKeyInput): BacSessionKeys {
  const seed = deriveBacSeed(input);
  return {
    kEnc: deriveDesKey(seed, 1),
    kMac: deriveDesKey(seed, 2),
  };
}
