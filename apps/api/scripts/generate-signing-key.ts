/**
 * Génère une paire de clés ECDSA P-256 pour signer les `VerificationResult` (voir
 * result-signer.service.ts et docs/kyc-integration.md "Vérification de la signature").
 *
 * Avertissement production — cette commande écrit une clé privée en clair sur la sortie standard,
 * ce qui est ACCEPTABLE pour amorcer un environnement de développement/test mais PAS pour la
 * production : un déploiement réel doit générer et détenir cette clé dans un HSM/KMS, jamais dans
 * une variable d'environnement en clair (voir docs/roadmap.md Phase 5).
 *
 * Usage : pnpm --filter @emrtd-verify/api generate-signing-key
 */
import { createHash, webcrypto } from "node:crypto";

function fingerprint(spkiBase64: string): string {
  const hex = createHash("sha256").update(Buffer.from(spkiBase64, "base64")).digest("hex").slice(0, 32).toUpperCase();
  return (hex.match(/..../g) ?? []).join(" ");
}

async function main(): Promise<void> {
  const keyPair = (await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;

  const privateKeyPkcs8 = Buffer.from(await webcrypto.subtle.exportKey("pkcs8", keyPair.privateKey)).toString("base64");
  const publicKeySpki = Buffer.from(await webcrypto.subtle.exportKey("spki", keyPair.publicKey)).toString("base64");

  process.stdout.write(
    [
      "Paire de clés ECDSA P-256 générée pour la signature des VerificationResult.",
      "",
      `VERIFICATION_RESULT_SIGNING_PRIVATE_KEY=${privateKeyPkcs8}`,
      `VERIFICATION_RESULT_SIGNING_PUBLIC_KEY=${publicKeySpki}`,
      "",
      // Même calcul que l'app mobile (keyFingerprint, apps/mobile/src/backend/backendClient.ts) :
      // l'opérateur la compare à l'écran Réglages › Serveur KYC avant d'épingler la clé.
      `Empreinte à comparer dans l'app : ${fingerprint(publicKeySpki)}`,
      "",
      "La clé privée ne doit être connue que du backend (jamais partagée, jamais committée).",
      "La clé publique est distribuée aux clients KYC via GET /v1/verifications/signing-key.",
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`Échec : ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
