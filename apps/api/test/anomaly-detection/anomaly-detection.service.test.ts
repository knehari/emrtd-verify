import { describe, it, expect } from "vitest";
import { AnomalyDetectionService } from "../../src/modules/anomaly-detection/anomaly-detection.service";
import type { ChainValidationResult } from "@emrtd-verify/pki-trust";
import type { MrzFieldValidation } from "@emrtd-verify/emrtd-core";

/**
 * `AnomalyDetectionService` n'est plus qu'une enveloppe injectable NestJS autour de
 * `detectAnomalies` (packages/verification-policy/src/anomalyDetection.ts) — la couverture
 * comportementale complète (tous les codes d'anomalie/sévérités) vit désormais dans ce package,
 * partagé avec apps/mobile. Ce test ne vérifie que la délégation elle-même.
 */
const baseTrustChain: ChainValidationResult = {
  source: "icao-pkd",
  level: "high",
  sufficientForClientPolicy: true,
  revocationChecked: true,
  revoked: false,
  dataGroupHashMismatches: [],
  noTrustAnchorAvailable: false,
  sodSignatureValid: true,
  dscTrustedByCsca: true,
  dscWithinValidityPeriod: true,
};

const validMrz: MrzFieldValidation = {
  documentNumberValid: true,
  dateOfBirthValid: true,
  dateOfExpiryValid: true,
  compositeValid: true,
};

describe("AnomalyDetectionService", () => {
  it("délègue à detectAnomalies et renvoie son résultat tel quel (cas propre)", () => {
    const service = new AnomalyDetectionService();
    const findings = service.detect({
      trustChain: baseTrustChain,
      mrzValidation: validMrz,
      documentExpectedToSupportAaOrCa: false,
      lostStolenCheck: { checked: true, reported: false },
    });
    expect(findings).toEqual([]);
  });

  it("délègue à detectAnomalies et renvoie son résultat tel quel (anomalie critique)", () => {
    const service = new AnomalyDetectionService();
    const findings = service.detect({
      trustChain: { ...baseTrustChain, revoked: true },
      mrzValidation: validMrz,
      documentExpectedToSupportAaOrCa: false,
      lostStolenCheck: { checked: true, reported: false },
    });
    expect(findings).toContainEqual(expect.objectContaining({ code: "CSCA_REVOKED", severity: "critical" }));
  });
});
