import type { Iso3166Alpha3 } from "./documentTypes";
import type { TrustLevel, TrustSourceKind } from "./verificationResult";

/**
 * Représentation sérialisable JSON d'un `CscaTrustAnchor` (packages/pki-trust) — `certificateDer`
 * y est un `Uint8Array`, non transportable tel quel en JSON, donc encodé en base64 ici. Voir
 * docs/pki-trust-model.md "Vérification hors ligne" pour le rôle de ce bundle.
 */
export interface CscaBundleAnchor {
  countryCode: Iso3166Alpha3;
  /** DER-encoded X.509, encodé en base64. */
  certificateDerBase64: string;
  subject: string;
  serialNumber: string;
  notBefore: string; // ISO 8601
  notAfter: string; // ISO 8601
  source: TrustSourceKind;
  level: TrustLevel;
}

/**
 * Bundle signé des ancres de confiance CSCA ICAO PKD, distribué au mobile pour lui permettre de
 * valider une chaîne de confiance (`validateTrustChain`, packages/pki-trust) sans connexion
 * réseau — voir docs/pki-trust-model.md "Vérification hors ligne". Ne couvre QUE les ancres ICAO
 * PKD du lot actif (`CscaTrustState.activeBatchId`) : le magasin de confiance étendu
 * (`ExtendedTrustStore`, fichier JSON local à apps/api) et le registre PKD national (LDAP, réseau
 * uniquement) restent hors de ce bundle v1 — limite documentée, pas un oubli.
 *
 * Signature ECDSA P-256 sur la sérialisation JSON canonique de ce bundle SANS le champ
 * `signature` lui-même (voir packages/emrtd-core/src/crypto/jsonSigning.ts, même mécanisme que
 * `VerificationResult.signature`) — le mobile doit vérifier cette signature avant de faire
 * confiance au bundle synchronisé (jamais de confiance implicite dans un fichier local, même
 * écrit par l'app elle-même : un appareil compromis pourrait l'avoir altéré hors ligne).
 */
export interface CscaBundle {
  /** Incrémenté si la structure de ce type change de façon non rétrocompatible. */
  bundleFormatVersion: 1;
  /** Identifiant du lot CscaSyncBatch dont proviennent ces ancres — traçabilité, pas une décision de confiance. */
  batchId: string;
  generatedAt: string; // ISO 8601
  anchors: CscaBundleAnchor[];
  algorithm: "ECDSA-P256-SHA256";
  /** Signature base64 de ce bundle sans ce champ — chaîne vide si aucune clé de signature n'est configurée côté serveur. */
  signature: string;
}
