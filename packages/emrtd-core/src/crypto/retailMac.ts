import { singleDesDecryptBlock, singleDesEncryptBlock } from "./tripleDes";

/**
 * Padding ISO/IEC 9797-1 méthode 2 : ajoute 0x80 puis des zéros jusqu'au prochain multiple de 8
 * octets — INCONDITIONNEL, contrairement à d'autres schémas de padding : même une entrée déjà
 * alignée reçoit un bloc de padding complet supplémentaire ([0x80, 0,0,0,0,0,0,0]). Doc 9303
 * Part 11 Appendix E.2 impose ce padding avant le calcul du retail MAC ET avant le chiffrement
 * 3DES-CBC des données de messagerie sécurisée (deux usages distincts, voir secureMessaging.ts).
 * `blockSize` = 16 pour la messagerie sécurisée AES établie par PACE (même règle, bloc AES).
 */
export function padIso9797Method2(data: Uint8Array, blockSize = 8): Uint8Array {
  const paddedLength = data.length + (blockSize - (data.length % blockSize));
  const padded = new Uint8Array(paddedLength);
  padded.set(data, 0);
  padded[data.length] = 0x80;
  return padded;
}

/** Retire un padding ISO/IEC 9797-1 méthode 2 — lève une erreur explicite si absent/mal formé. */
export function unpadIso9797Method2(padded: Uint8Array): Uint8Array {
  let end = padded.length;
  while (end > 0 && padded[end - 1] === 0x00) {
    end--;
  }
  if (end === 0 || padded[end - 1] !== 0x80) {
    throw new Error("Padding ISO/IEC 9797-1 méthode 2 invalide ou absent");
  }
  return padded.subarray(0, end - 1);
}

function xorBlocks(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) out[i] = a[i] ^ b[i];
  return out;
}

/**
 * Retail MAC — ISO/IEC 9797-1 MAC Algorithm 3 (dit "ANSI retail MAC"), tel qu'imposé par Doc 9303
 * Part 11 Appendix E.1 pour KMac. Confirmé indépendamment par la suite de conformité ETSI
 * (STF400, `ePassport_Functions.ttcn` `f_cryptographicChecksum` : "Compute a cryptographic
 * checksum using ISO/IEC 9797-1 MAC algorithm 3 with block cipher DES, zero IV (8 bytes) and
 * ISO9797-1 padding method 2"). `data` DOIT déjà être paddée (padIso9797Method2) et alignée sur
 * 8 octets ; `key16` = K1||K2 (16 octets, les deux moitiés de KMac). Algorithme :
 *   H_0 = 0 (8 octets nuls)
 *   H_i = DES_encrypt(K1, H_{i-1} XOR bloc_i)  pour chaque bloc de 8 octets, y compris le dernier
 *   MAC = DES_encrypt(K1, DES_decrypt(K2, H_n))  — étape finale à 2 clés, structure standard du
 *   MAC Algorithm 3 (CBC-MAC simple DES suivi d'un "décrypt-encrypt" final avec la seconde clé).
 */
export function computeRetailMac(key16: Uint8Array, data: Uint8Array): Uint8Array {
  if (key16.length !== 16) {
    throw new Error(`computeRetailMac attend une clé de 16 octets (K1||K2), reçu ${key16.length}`);
  }
  if (data.length === 0 || data.length % 8 !== 0) {
    throw new Error(`computeRetailMac attend des données paddées, multiples de 8 octets (reçu ${data.length})`);
  }

  const k1 = key16.subarray(0, 8);
  const k2 = key16.subarray(8, 16);

  let chain: Uint8Array = new Uint8Array(8);
  for (let offset = 0; offset < data.length; offset += 8) {
    const block = data.subarray(offset, offset + 8);
    chain = singleDesEncryptBlock(k1, xorBlocks(chain, block));
  }

  return singleDesEncryptBlock(k1, singleDesDecryptBlock(k2, chain));
}

/** Compare deux MAC en temps constant (évite une attaque par canal auxiliaire sur la comparaison). */
export function constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
