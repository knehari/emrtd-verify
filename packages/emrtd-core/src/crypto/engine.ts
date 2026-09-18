import { webcrypto } from "node:crypto";
import { CryptoEngine, setEngine } from "pkijs";

let initialized = false;

/**
 * pkijs a besoin d'un moteur WebCrypto explicite en environnement Node
 * (il ne le détecte pas automatiquement comme dans un navigateur).
 * Idempotent — sûr à appeler au début de chaque fonction qui utilise pkijs.
 */
export function ensurePkiEngine(): void {
  if (initialized) {
    return;
  }
  const cryptoImpl = webcrypto as unknown as Crypto;
  setEngine("nodeEngine", new CryptoEngine({ name: "nodeEngine", crypto: cryptoImpl, subtle: cryptoImpl.subtle }));
  initialized = true;
}
