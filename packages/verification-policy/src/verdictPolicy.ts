import type { ActiveLivenessResult, AnomalyFinding, FaceMatchResult, TrustChainResult, Verdict } from "@emrtd-verify/shared-types";

export interface VerdictInput {
  trustChain: TrustChainResult;
  anomalies: AnomalyFinding[];
  faceMatch?: FaceMatchResult;
  activeLiveness?: ActiveLivenessResult;
  allFieldChecksValid: boolean;
}

/**
 * Synthèse du verdict global à partir de tous les signaux — isolée ici (plutôt que dispersée
 * dans les vérifications elles-mêmes) pour rester auditable et ajustable sans toucher à la
 * logique de vérification. Voir docs/verification-checklist.md "Verdict global". Fonction pure
 * et portable (Node ET React Native) — appelée à l'identique par apps/api (chemin en ligne) et
 * apps/mobile (chemin hors ligne, voir docs/pki-trust-model.md "Vérification hors ligne").
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

  // Une réponse active TENTÉE mais qui échoue (minutage incohérent, action non exécutée) n'est
  // pas nécessairement une preuve de fraude (réseau, confusion utilisateur) — dégrade vers une
  // revue humaine plutôt qu'un rejet automatique, même logique que l'inconclusive ci-dessus. Une
  // falsification du challenge lui-même (signature invalide) remonte en anomalie CRITIQUE dès la
  // détection (voir VerificationProcessor), donc déjà couverte par hasCritical ci-dessus.
  if (input.activeLiveness?.performed && !input.activeLiveness.passed) {
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
