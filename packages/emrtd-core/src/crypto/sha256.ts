import hash from "hash.js";

/**
 * SHA-256 portable (Node ET React Native) — même primitive `hash.js` que sha1.ts (indutny, même
 * auteur/famille que des.js), pour les mêmes raisons de portabilité (`crypto.subtle` absent de
 * React Native/Hermes). Utilisé pour le hash-chaînage des frames de liveness active
 * (voir liveness/frameIntegrity.ts) — SHA-1 est jugé insuffisant pour un usage anti-falsification
 * neuf (contrairement à la dérivation de clé BAC, imposée par Doc 9303 Part 11 Appendix D.1, SHA-256
 * est ici un choix libre).
 */
export function sha256(bytes: Uint8Array): Uint8Array {
  const digest = hash.sha256().update(Array.from(bytes)).digest();
  return Uint8Array.from(digest);
}

export function sha256Hex(bytes: Uint8Array): string {
  return Array.from(sha256(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
