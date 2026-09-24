import { CryptoEngine, setEngine } from "pkijs";

let initialized = false;

/**
 * pkijs a besoin d'un moteur WebCrypto explicite en environnement sans `window.crypto`
 * implicite (il ne le détecte pas automatiquement hors navigateur). On utilise le Web
 * Crypto global (`globalThis.crypto`, natif depuis Node 20, présent aussi en navigateur
 * et polyfillable en React Native) plutôt qu'un import `node:crypto` explicite, pour que
 * ce module reste importable côté mobile sans casser le bundler (voir docs/architecture.md
 * "pourquoi ce découpage" : packages/emrtd-core doit rester réutilisable côté mobile).
 * Idempotent — sûr à appeler au début de chaque fonction qui utilise pkijs.
 */
export function ensurePkiEngine(): void {
  if (initialized) {
    return;
  }
  if (typeof globalThis.crypto?.subtle === "undefined") {
    // React Native/Hermes : pas de Web Crypto. Le décodage ASN.1/X.509/CMS de pkijs n'en a pas
    // besoin, et toutes les vérifications de signature passent par pureVerify.ts — seules les
    // opérations pkijs cryptographiques (jamais appelées sur ce chemin) resteraient indisponibles.
    initialized = true;
    return;
  }
  setEngine("nodeEngine", new CryptoEngine({ name: "globalEngine", crypto: globalThis.crypto, subtle: globalThis.crypto.subtle }));
  initialized = true;
}
