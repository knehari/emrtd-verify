import hash from "hash.js";

/**
 * SHA-384/SHA-512 portables (Node ET React Native), même famille que sha1.ts/sha256.ts —
 * `hash.js` les expose nativement (`hash.sha384`/`hash.sha512`), vérifié par exécution réelle
 * contre `node:crypto` (vecteurs chaîne vide et "abc") avant intégration ici. Nécessaires pour
 * `LdsSecurityObject.digestAlgorithm` (voir lds/sod.ts) : Doc 9303 Part 11 §4 permet SHA-256,
 * SHA-384 ou SHA-512 pour le hachage des groupes de données, pas seulement SHA-256.
 */
export function sha384(bytes: Uint8Array): Uint8Array {
  const digest = hash.sha384().update(Array.from(bytes)).digest();
  return Uint8Array.from(digest);
}

export function sha512(bytes: Uint8Array): Uint8Array {
  const digest = hash.sha512().update(Array.from(bytes)).digest();
  return Uint8Array.from(digest);
}
