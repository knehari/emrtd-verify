import { cbc, ecb } from "@noble/ciphers/aes";

/**
 * AES portable (Node ET React Native) pour PACE et la messagerie sécurisée AES (Doc 9303 Part 11
 * §9.8, BSI TR-03110-3 §F) : même logique que tripleDes.ts — ni Web Crypto (asynchrone, pas d'ECB
 * ni de CBC sans padding) ni React Native (pas de `node:crypto`) ne conviennent, `@noble/ciphers`
 * (pur JS, audité) fait tourner exactement le même code en test et sur l'appareil. Aucun padding
 * implicite : le padding ISO/IEC 9797-1 méthode 2 reste la responsabilité de l'appelant.
 */

function assertAesKey(key: Uint8Array): void {
  if (key.length !== 16 && key.length !== 24 && key.length !== 32) {
    throw new Error(`Clé AES invalide : attendu 16, 24 ou 32 octets, reçu ${key.length}`);
  }
}

function assertBlockAligned(data: Uint8Array): void {
  if (data.length === 0 || data.length % 16 !== 0) {
    throw new Error(`Données non alignées sur un bloc AES (16 octets) : longueur ${data.length}`);
  }
}

export function aesEcbEncryptBlock(key: Uint8Array, block16: Uint8Array): Uint8Array {
  assertAesKey(key);
  if (block16.length !== 16) {
    throw new Error(`aesEcbEncryptBlock attend un bloc de 16 octets, reçu ${block16.length}`);
  }
  return ecb(key, { disablePadding: true }).encrypt(block16);
}

export function aesCbcEncrypt(key: Uint8Array, iv16: Uint8Array, data: Uint8Array): Uint8Array {
  assertAesKey(key);
  assertBlockAligned(data);
  return cbc(key, iv16, { disablePadding: true }).encrypt(data);
}

export function aesCbcDecrypt(key: Uint8Array, iv16: Uint8Array, data: Uint8Array): Uint8Array {
  assertAesKey(key);
  assertBlockAligned(data);
  return cbc(key, iv16, { disablePadding: true }).decrypt(data);
}

/** Doublement dans GF(2^128) (RFC 4493 §2.3, génération des sous-clés K1/K2). */
function doubleBlock(block: Uint8Array): Uint8Array {
  const out = new Uint8Array(16);
  for (let i = 0; i < 15; i++) out[i] = ((block[i] << 1) | (block[i + 1] >> 7)) & 0xff;
  out[15] = (block[15] << 1) & 0xff;
  if (block[0] & 0x80) out[15] ^= 0x87;
  return out;
}

/**
 * AES-CMAC complet (16 octets, RFC 4493 / NIST SP 800-38B). Doc 9303 et TR-03110 le tronquent à 8
 * octets pour la messagerie sécurisée et les jetons d'authentification PACE — voir `aesCmac8`.
 */
export function aesCmac(key: Uint8Array, message: Uint8Array): Uint8Array {
  assertAesKey(key);
  const encryptBlock = (block: Uint8Array) => ecb(key, { disablePadding: true }).encrypt(block);
  const k1 = doubleBlock(encryptBlock(new Uint8Array(16)));
  const k2 = doubleBlock(k1);

  const blockCount = Math.max(1, Math.ceil(message.length / 16));
  const lastComplete = message.length > 0 && message.length % 16 === 0;
  const lastStart = (blockCount - 1) * 16;
  const last = new Uint8Array(16);
  if (lastComplete) {
    for (let i = 0; i < 16; i++) last[i] = message[lastStart + i] ^ k1[i];
  } else {
    const tail = message.subarray(lastStart);
    last.set(tail, 0);
    last[tail.length] = 0x80;
    for (let i = 0; i < 16; i++) last[i] ^= k2[i];
  }

  let x: Uint8Array = new Uint8Array(16);
  for (let b = 0; b < blockCount - 1; b++) {
    const y = new Uint8Array(16);
    for (let i = 0; i < 16; i++) y[i] = x[i] ^ message[b * 16 + i];
    x = encryptBlock(y);
  }
  for (let i = 0; i < 16; i++) last[i] ^= x[i];
  return encryptBlock(last);
}

export function aesCmac8(key: Uint8Array, message: Uint8Array): Uint8Array {
  return aesCmac(key, message).subarray(0, 8);
}
