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

export interface TrustChainResult {
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
  anomalies: AnomalyFinding[];
  verifiedAt: string; // ISO 8601
  /** Signature du résultat par la plateforme (voir docs/kyc-integration.md). */
  signature: string;
}
