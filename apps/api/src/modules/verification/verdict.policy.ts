import type { AnomalyFinding, FaceMatchResult, TrustChainResult, Verdict } from "@emrtd-verify/shared-types";

export interface VerdictInput {
  trustChain: TrustChainResult;
  anomalies: AnomalyFinding[];
  faceMatch?: FaceMatchResult;
  allFieldChecksValid: boolean;
}

/**
 * Synthèse du verdict global à partir de tous les signaux — isolée ici (plutôt que dispersée
 * dans les vérifications elles-mêmes) pour rester auditable et ajustable sans toucher à la
 * logique de vérification. Voir docs/verification-checklist.md "Verdict global".
 */
export function computeVerdict(input: VerdictInput): Verdict {
  const hasCritical = input.anomalies.some((a) => a.severity === "critical");
  if (hasCritical) {
    return "rejected";
  }

  if (!input.trustChain.sufficientForClientPolicy) {
    return "manual_review_required";
  }

  if (input.faceMatch?.matchDecision === "inconclusive" || input.faceMatch?.livenessPassed === false) {
    return "manual_review_required";
  }

  const hasWarning = input.anomalies.some((a) => a.severity === "warning");
  if (hasWarning || !input.allFieldChecksValid) {
    return "suspicious";
  }

  if (input.faceMatch && input.faceMatch.matchDecision === "no_match") {
    return "rejected";
  }

  return "authentic";
}
