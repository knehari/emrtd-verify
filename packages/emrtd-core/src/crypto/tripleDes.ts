/// <reference path="./des.d.ts" />
// La directive ci-dessus est nécessaire (pas seulement le fichier des.d.ts lui-même) : ce paquet
// distribue ses sources TypeScript directement (package.json "types": "src/index.ts"), donc la
// compilation d'un consommateur (ex. apps/mobile) qui n'inclut QUE son propre src ne charge
// jamais des.d.ts sans cette référence explicite, même si tripleDes.ts est atteint via le graphe
// d'imports.
import { CBC, DES, EDE, type DesCipherInstance } from "des.js";

/**
 * 3DES-CBC portable (Node ET React Native) pour la messagerie sécurisée BAC (Doc 9303 Part 11
 * §4.3, Appendix E). Ni le Web Crypto standard (DES/3DES en sont délibérément exclus, jugés
 * obsolètes) ni React Native (pas de `node:crypto`) n'exposent nativement le 3DES — `des.js`
 * (paquet pur TypeScript/JS, indutny, sans dépendance native) fait tourner exactement le même
 * code en environnement de test (Node/vitest) et sur l'appareil mobile, éliminant tout risque de
 * divergence de comportement crypto entre les deux. Sa propre suite de tests vérifie déjà chaque
 * opération CBC/EDE contre `node:crypto` (`des-ede3-cbc`) — voir des.js@1.1.0 test/ede-test.js.
 */

function toNumberArray(bytes: Uint8Array): number[] {
  return Array.from(bytes);
}

/**
 * Doc 9303 utilise le 3DES à DEUX clés (KEnc/KMac = K1||K2, 16 octets), pas trois — l'expansion
 * canonique en 3DES "EDE" à trois clés consiste à répéter K1 comme troisième clé (K1||K2||K1),
 * équivalent mathématique standard (FIPS 46-3/SP 800-67) et propriété qu'utilise `des.js`, dont
 * l'implémentation EDE exige explicitement 24 octets (voir des.js lib/des/ede.js `EDEState`).
 * Confirmé indépendamment par la suite de conformité ETSI (STF400, `ePassport_Functions.ttcn`
 * `f_build3DesKey` : "return p_keyPair & v_ka; // Ka || Kb || Ka").
 */
function expandTwoKeyToThreeKey(key16: Uint8Array): Uint8Array {
  if (key16.length !== 16) {
    throw new Error(`Clé 3DES à 2 clés invalide : attendu 16 octets, reçu ${key16.length}`);
  }
  const expanded = new Uint8Array(24);
  expanded.set(key16, 0);
  expanded.set(key16.subarray(0, 8), 16);
  return expanded;
}

function runCipher(cipher: DesCipherInstance, data: Uint8Array): Uint8Array {
  const out = cipher.update(toNumberArray(data)).concat(cipher.final());
  return Uint8Array.from(out);
}

function assertBlockAligned(data: Uint8Array): void {
  if (data.length === 0 || data.length % 8 !== 0) {
    throw new Error(`Données non alignées sur un bloc DES (8 octets) : longueur ${data.length}`);
  }
}

/**
 * Chiffre/déchiffre en 3DES-CBC (IV fourni, jamais généré ici) — `data` DOIT déjà être un
 * multiple de 8 octets (bloc DES) : ni padding ni dépadding implicite (voir des.d.ts `padding:
 * false`), le padding ISO/IEC 9797-1 méthode 2 est la responsabilité de l'appelant
 * (secureMessaging.ts/retailMac.ts) car son application diffère entre chiffrement et MAC.
 */
export function tripleDesCbcEncrypt(key16: Uint8Array, iv8: Uint8Array, data: Uint8Array): Uint8Array {
  assertBlockAligned(data);
  const cbc = CBC.instantiate(EDE);
  const cipher = cbc.create({ type: "encrypt", key: toNumberArray(expandTwoKeyToThreeKey(key16)), iv: toNumberArray(iv8), padding: false });
  return runCipher(cipher, data);
}

export function tripleDesCbcDecrypt(key16: Uint8Array, iv8: Uint8Array, data: Uint8Array): Uint8Array {
  assertBlockAligned(data);
  const cbc = CBC.instantiate(EDE);
  const cipher = cbc.create({ type: "decrypt", key: toNumberArray(expandTwoKeyToThreeKey(key16)), iv: toNumberArray(iv8), padding: false });
  return runCipher(cipher, data);
}

/** DES simple (une seule clé, 8 octets), sans chaînage CBC — brique de base du retail MAC (retailMac.ts). */
export function singleDesEncryptBlock(key8: Uint8Array, block8: Uint8Array): Uint8Array {
  if (key8.length !== 8 || block8.length !== 8) {
    throw new Error("singleDesEncryptBlock attend une clé et un bloc de 8 octets chacun");
  }
  const cipher = DES.create({ type: "encrypt", key: toNumberArray(key8), padding: false });
  return runCipher(cipher, block8);
}

export function singleDesDecryptBlock(key8: Uint8Array, block8: Uint8Array): Uint8Array {
  if (key8.length !== 8 || block8.length !== 8) {
    throw new Error("singleDesDecryptBlock attend une clé et un bloc de 8 octets chacun");
  }
  const cipher = DES.create({ type: "decrypt", key: toNumberArray(key8), padding: false });
  return runCipher(cipher, block8);
}
