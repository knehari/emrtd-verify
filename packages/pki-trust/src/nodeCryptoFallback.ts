/**
 * Enregistre le vérificateur ECDSA de repli basé sur node:crypto (OpenSSL) — le seul endroit de ce
 * monorepo qui importe `node:crypto` pour la vérification de signature. Vit dans pki-trust (déjà
 * Node-only en pratique : dépend de ldapjs, jamais consommé par apps/mobile) plutôt que dans
 * emrtd-core (compilé comme dépendance source par apps/mobile, qui n'a pas les types Node) — voir
 * emrtd-core/src/crypto/signatureVerify.ts.
 *
 * Importé pour son effet de bord dès que ce package est chargé (voir index.ts) : n'importe quel
 * consommateur de packages/pki-trust (aujourd'hui : apps/api uniquement) bénéficie automatiquement
 * du support des courbes ECDSA non-NIST (Brainpool notamment, RFC 5639/BSI TR-03110) sans étape
 * d'initialisation manuelle.
 */
import { registerEcdsaFallbackVerifier } from "@emrtd-verify/emrtd-core";

registerEcdsaFallbackVerifier(async ({ spkiDer, hash, signature, signedData }) => {
  const nodeCrypto = await import("node:crypto");
  const publicKey = nodeCrypto.createPublicKey({ key: Buffer.from(spkiDer), format: "der", type: "spki" });
  const hashName = hash.toLowerCase().replace("-", "");
  return nodeCrypto.verify(hashName, Buffer.from(signedData), publicKey, Buffer.from(signature));
});
