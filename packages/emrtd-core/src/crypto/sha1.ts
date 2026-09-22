import hash from "hash.js";

/**
 * SHA-1 portable (Node ET React Native) — remplace le `globalThis.crypto.subtle.digest` utilisé
 * précédemment. `crypto.subtle` n'existe pas nativement sur React Native/Hermes (contrairement à
 * Node ≥20 et aux navigateurs) — c'est le seul maillon qui restait manquant pour exécuter
 * `bacKey.ts` sur un appareil mobile réel (`crypto.getRandomValues`, lui, est déjà comblé par
 * `react-native-get-random-values`, voir apps/mobile/App.tsx). `hash.js` (indutny, même
 * auteur/famille que `des.js` déjà utilisé pour le 3DES) fait tourner exactement le même code en
 * environnement de test (Node/vitest) et sur l'appareil mobile — mêmes garanties de non-
 * divergence que pour tripleDes.ts. SHA-1 n'est plus recommandé pour la signature, mais reste
 * l'algorithme imposé par Doc 9303 Part 11 Appendix D.1 pour la dérivation de clé BAC.
 */
export function sha1(bytes: Uint8Array): Uint8Array {
  const digest = hash.sha1().update(Array.from(bytes)).digest();
  return Uint8Array.from(digest);
}
