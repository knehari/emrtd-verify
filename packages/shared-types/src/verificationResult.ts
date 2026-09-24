import type { DocumentType, Iso3166Alpha3 } from "./documentTypes";

export type Verdict = "authentic" | "suspicious" | "rejected" | "manual_review_required";

export type TrustSourceKind = "icao-pkd" | "national-pkd" | "extended-trust-store";

export type TrustLevel = "high" | "medium" | "low";

export interface FieldCheck {
  value: string;
  valid: boolean;
  /** Identifiants des contrôles appliqués, ex. "checkDigit", "mrzVizConsistency". */
  checks: string[];
}

/** Résumé d'un certificat de la chaîne (affiché tel quel à l'utilisateur, jamais réinterprété). */
export interface CertificateSummary {
  subject: string;
  issuer: string;
  serialNumber: string;
  notBefore: string; // ISO 8601
  notAfter: string; // ISO 8601
}

export interface TrustChainResult {
  /** Détail du CSCA retenu (celui qui a effectivement signé le DSC) et du DSC, si disponibles. */
  csca?: CertificateSummary;
  dsc?: CertificateSummary;
  source: TrustSourceKind;
  level: TrustLevel;
  /** true si ce niveau satisfait la politique de risque configurée pour le client KYC appelant. */
  sufficientForClientPolicy: boolean;
  cscaSubject?: string;
  dscSubject?: string;
  revocationChecked: boolean;
  revoked: boolean;
}

export type MatchDecision = "match" | "no_match" | "inconclusive";

export interface FaceMatchResult {
  similarityScore: number; // [0, 1]
  matchDecision: MatchDecision;
  livenessPassed: boolean;
  qualityWarnings: string[];
}

/**
 * Résultat de la liveness ACTIVE (challenge-réponse à séquence d'actions aléatoire, voir
 * packages/emrtd-core/src/liveness/ et docs/facial-recognition.md) — distincte de
 * `FaceMatchResult.livenessPassed` qui reste une heuristique passive sur une seule image.
 * `performed: false` signifie qu'aucune réponse n'a été soumise (mobile non mis à jour, refus
 * utilisateur, etc.) — ne jamais interpréter l'absence comme un succès implicite.
 */
export interface ActiveLivenessResult {
  performed: boolean;
  passed: boolean;
  method: "active_challenge_response";
}

/**
 * Résumé de la vérification d'intégrité de l'application/l'appareil (App Attest iOS / Play
 * Integrity Android) — voir docs/facial-recognition.md "Intégrité de l'application et de
 * l'appareil". `verified: false` ne dégrade PAS le verdict à lui seul aujourd'hui (voir
 * `DEVICE_ATTESTATION_NOT_VERIFIED`, anomalie de sévérité "info") : la vérification
 * cryptographique réelle n'étant pas encore implémentée côté serveur, un `false` reflète
 * honnêtement cet état actuel plutôt qu'un signal de fraude.
 */
export interface DeviceAttestationSummary {
  platform: "ios" | "android";
  verified: boolean;
}

export type AnomalySeverity = "info" | "warning" | "critical";

export interface AnomalyFinding {
  code: string;
  severity: AnomalySeverity;
  message: string;
}

export interface VerificationResult {
  verificationId: string;
  verdict: Verdict;
  document: {
    type: DocumentType;
    issuingCountry: Iso3166Alpha3;
    /** Uniquement les champs demandés par le client KYC — principe de minimisation. */
    fields: Record<string, FieldCheck>;
  };
  trustChain: TrustChainResult;
  faceMatch?: FaceMatchResult;
  activeLiveness?: ActiveLivenessResult;
  deviceAttestation?: DeviceAttestationSummary;
  anomalies: AnomalyFinding[];
  verifiedAt: string; // ISO 8601
  /** Signature du résultat par la plateforme (voir docs/kyc-integration.md). */
  signature: string;
}
