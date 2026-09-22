import type { TrustLevel } from "@emrtd-verify/shared-types";

/**
 * Configuration embarquée à la compilation — un même build mobile est déployé pour un client KYC
 * donné (modèle SaaS marque blanche, voir docs/kyc-integration.md), donc `apiKey` lui est propre.
 *
 * `cscaBundleSigningPublicKeyBase64` DOIT être embarquée ici (jamais récupérée dynamiquement
 * depuis le réseau) : c'est la racine de confiance qui permet de vérifier la signature du bundle
 * CSCA synchronisé (voir pki/cscaBundleSync.ts et docs/pki-trust-model.md "Vérification hors
 * ligne") — si elle était elle-même récupérée sur le réseau au premier lancement, un attaquant en
 * position de MITM à ce moment-là pourrait fournir sa propre clé aux côtés d'un faux bundle,
 * rendant toute vérification de signature ultérieure inutile (confiance circulaire). Même principe
 * que la racine de confiance CSCA Master List Signer épinglée côté serveur
 * (config/master-list-signer-trust-anchors.json, jamais auto-bootstrapée).
 *
 * `acceptedTrustLevels` reflète la politique de risque du client KYC (KycClient.acceptedTrustLevels
 * côté serveur, voir apps/api/src/modules/kyc/kyc-client.service.ts) — utilisée par
 * `validateTrustChain` pour le verdict PROVISOIRE calculé hors ligne (voir
 * src/verification/localVerification.ts). N'est qu'une commodité d'UX immédiate : la
 * réconciliation backend (obligatoire, voir src/sync/) revalide toujours indépendamment avec la
 * politique réelle stockée côté serveur, jamais avec cette copie locale.
 *
 * TODO(roadmap) : sourcer ces valeurs depuis la configuration de build (app.config.ts / variables
 * d'environnement EAS Build) plutôt qu'en dur, une fois le pipeline de build par tenant en place.
 */
export interface AppConfig {
  apiBaseUrl: string;
  apiKey: string;
  /** SPKI base64 — voir GET /v1/pki-trust/csca-bundle/signing-key pour obtenir la valeur courante à embarquer. */
  cscaBundleSigningPublicKeyBase64: string;
  acceptedTrustLevels: TrustLevel[];
}

export const appConfig: AppConfig = {
  apiBaseUrl: "https://api.example.invalid",
  apiKey: "",
  cscaBundleSigningPublicKeyBase64: "",
  acceptedTrustLevels: ["high"],
};
