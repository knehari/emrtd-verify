/**
 * Ré-export de `computeVerdict`/`VerdictInput`
 * (packages/verification-policy/src/verdictPolicy.ts, la logique réelle — désormais partagée
 * avec apps/mobile pour la vérification hors ligne, voir docs/pki-trust-model.md "Vérification
 * hors ligne"). Conservé ici pour ne pas casser les imports existants (VerificationProcessor).
 */
export { computeVerdict, type VerdictInput } from "@emrtd-verify/verification-policy";
