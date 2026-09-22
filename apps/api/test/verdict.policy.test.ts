import { describe, it, expect } from "vitest";
import { computeVerdict } from "../src/modules/verification/verdict.policy";
import type { TrustChainResult } from "@emrtd-verify/shared-types";

const baseTrustChain: TrustChainResult = {
  source: "icao-pkd",
  level: "high",
  sufficientForClientPolicy: true,
  revocationChecked: true,
  revoked: false,
};

describe("computeVerdict", () => {
  it("retourne authentic quand tout est valide", () => {
    expect(
      computeVerdict({
        trustChain: baseTrustChain,
        anomalies: [],
        allFieldChecksValid: true,
      }),
    ).toBe("authentic");
  });

  it("retourne rejected dès qu'une anomalie critique est présente", () => {
    expect(
      computeVerdict({
        trustChain: baseTrustChain,
        anomalies: [{ code: "DG_HASH_MISMATCH", severity: "critical", message: "x" }],
        allFieldChecksValid: true,
      }),
    ).toBe("rejected");
  });

  it("retourne suspicious sur une anomalie warning sans critique", () => {
    expect(
      computeVerdict({
        trustChain: baseTrustChain,
        anomalies: [{ code: "MISSING_ACTIVE_CHIP_AUTH", severity: "warning", message: "x" }],
        allFieldChecksValid: true,
      }),
    ).toBe("suspicious");
  });

  it("retourne manual_review_required si la confiance PKI est insuffisante pour la politique client", () => {
    expect(
      computeVerdict({
        trustChain: { ...baseTrustChain, sufficientForClientPolicy: false },
        anomalies: [],
        allFieldChecksValid: true,
      }),
    ).toBe("manual_review_required");
  });

  it("retourne rejected si le visage ne correspond pas", () => {
    expect(
      computeVerdict({
        trustChain: baseTrustChain,
        anomalies: [],
        allFieldChecksValid: true,
        faceMatch: { similarityScore: 0.1, matchDecision: "no_match", livenessPassed: true, qualityWarnings: [] },
      }),
    ).toBe("rejected");
  });

  it("retourne manual_review_required si le liveness échoue", () => {
    expect(
      computeVerdict({
        trustChain: baseTrustChain,
        anomalies: [],
        allFieldChecksValid: true,
        faceMatch: { similarityScore: 0.9, matchDecision: "match", livenessPassed: false, qualityWarnings: [] },
      }),
    ).toBe("manual_review_required");
  });

  it("retourne manual_review_required si la liveness active a été tentée mais a échoué", () => {
    expect(
      computeVerdict({
        trustChain: baseTrustChain,
        anomalies: [{ code: "ACTIVE_LIVENESS_FAILED", severity: "warning", message: "x" }],
        allFieldChecksValid: true,
        activeLiveness: { performed: true, passed: false, method: "active_challenge_response" },
      }),
    ).toBe("manual_review_required");
  });

  it("retourne authentic quand la liveness active a été tentée et validée (tout le reste valide)", () => {
    expect(
      computeVerdict({
        trustChain: baseTrustChain,
        anomalies: [],
        allFieldChecksValid: true,
        activeLiveness: { performed: true, passed: true, method: "active_challenge_response" },
      }),
    ).toBe("authentic");
  });

  it("l'absence de liveness active (non tentée) ne dégrade pas le verdict à elle seule", () => {
    expect(
      computeVerdict({
        trustChain: baseTrustChain,
        anomalies: [],
        allFieldChecksValid: true,
        activeLiveness: undefined,
      }),
    ).toBe("authentic");
  });
});
