import { Injectable } from "@nestjs/common";
import type { AnomalyFinding } from "@emrtd-verify/shared-types";
import { detectAnomalies, type AnomalyDetectionInput } from "@emrtd-verify/verification-policy";

export type { AnomalyDetectionInput };

/**
 * Enveloppe injectable NestJS autour de `detectAnomalies`
 * (packages/verification-policy/src/anomalyDetection.ts, la logique réelle — désormais partagée
 * avec apps/mobile pour la vérification hors ligne, voir docs/pki-trust-model.md "Vérification
 * hors ligne"). Reste une classe injectable ici pour ne pas perturber le câblage DI existant
 * (VerificationProcessor).
 */
@Injectable()
export class AnomalyDetectionService {
  detect(input: AnomalyDetectionInput): AnomalyFinding[] {
    return detectAnomalies(input);
  }
}
