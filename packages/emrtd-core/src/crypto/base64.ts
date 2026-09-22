/**
 * Base64 portable (RFC 4648 §4), sans dépendre de `atob`/`btoa` — contrairement à ce que
 * jsonSigning.ts supposait jusqu'ici, React Native 0.74/Hermes ne les expose PAS nativement
 * (confirmé en cherchant dans les sources de react-native lui-même : aucune configuration
 * `global.atob`/`global.btoa`), seul Node/les navigateurs les fournissent — ce qui rendait
 * jsonSigning.ts non portable en pratique malgré son intention documentée. Implémentation
 * autonome, vérifiée par exécution réelle contre `Buffer.from(...).toString("base64")` (vecteurs
 * chaîne vide, alignements 1/2/3 octets restants, tous les octets 0x00–0xFF) avant intégration ici.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  let result = "";
  let i = 0;
  for (; i + 3 <= bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    result += ALPHABET[(n >> 18) & 0x3f] + ALPHABET[(n >> 12) & 0x3f] + ALPHABET[(n >> 6) & 0x3f] + ALPHABET[n & 0x3f];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const n = bytes[i] << 16;
    result += ALPHABET[(n >> 18) & 0x3f] + ALPHABET[(n >> 12) & 0x3f] + "==";
  } else if (remaining === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    result += ALPHABET[(n >> 18) & 0x3f] + ALPHABET[(n >> 12) & 0x3f] + ALPHABET[(n >> 6) & 0x3f] + "=";
  }
  return result;
}

const DECODE_TABLE = (() => {
  const table = new Int16Array(256).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) {
    table[ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, "");
  const byteLength = Math.floor((clean.length * 6) / 8);
  const result = new Uint8Array(byteLength);
  let bitBuffer = 0;
  let bitCount = 0;
  let outIndex = 0;
  for (let i = 0; i < clean.length; i++) {
    const value = DECODE_TABLE[clean.charCodeAt(i)];
    if (value === -1) continue;
    bitBuffer = (bitBuffer << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      result[outIndex++] = (bitBuffer >> bitCount) & 0xff;
    }
  }
  return result;
}
