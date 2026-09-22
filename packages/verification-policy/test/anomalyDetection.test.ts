import { describe, it, expect } from "vitest";
import { detectAnomalies, type DocumentStatusCheckResult } from "../src/anomalyDetection";
import type { ChainValidationResult } from "@emrtd-verify/pki-trust";
import type { MrzFieldValidation } from "@emrtd-verify/emrtd-core";

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

const baseLostStolenCheck: DocumentStatusCheckResult = { checked: true, reported: false };

describe("detectAnomalies", () => {
  it("ne remonte aucune anomalie quand tous les signaux sont propres", () => {
    const findings = detectAnomalies({
      trustChain: baseTrustChain,
      mrzValidation: validMrz,
      documentExpectedToSupportAaOrCa: false,
      lostStolenCheck: baseLostStolenCheck,
    });
    expect(findings).toHaveLength(0);
  });

  it("signale un hash de DG divergent en critique", () => {
    const findings = detectAnomalies({
      trustChain: { ...baseTrustChain, dataGroupHashMismatches: [1, 2] },
      mrzValidation: validMrz,
      documentExpectedToSupportAaOrCa: false,
      lostStolenCheck: baseLostStolenCheck,
    });
    expect(findings).toContainEqual(expect.objectContaining({ code: "DG_HASH_MISMATCH", severity: "critical" }));
  });

  it("signale l'absence de tout CSCA de confiance en critique", () => {
    const findings = detectAnomalies({
      trustChain: { ...baseTrustChain, noTrustAnchorAvailable: true },
      mrzValidation: validMrz,
      documentExpectedToSupportAaOrCa: false,
      lostStolenCheck: baseLostStolenCheck,
    });
    expect(findings).toContainEqual(expect.objectContaining({ code: "NO_TRUST_ANCHOR", severity: "critical" }));
  });

  it("signale un niveau de confiance bas (magasin étendu) en avertissement, sans doublon avec NO_TRUST_ANCHOR", () => {
    const findings = detectAnomalies({
      trustChain: { ...baseTrustChain, level: "low" },
      mrzValidation: validMrz,
      documentExpectedToSupportAaOrCa: false,
      lostStolenCheck: baseLostStolenCheck,
    });
    expect(findings).toContainEqual(expect.objectContaining({ code: "LOW_TRUST_LEVEL", severity: "warning" }));
    expect(findings.some((f) => f.code === "NO_TRUST_ANCHOR")).toBe(false);
  });

  it("signale un CSCA/DSC révoqué en critique", () => {
    const findings = detectAnomalies({
      trustChain: { ...baseTrustChain, revoked: true },
      mrzValidation: validMrz,
      documentExpectedToSupportAaOrCa: false,
      lostStolenCheck: baseLostStolenCheck,
    });
    expect(findings).toContainEqual(expect.objectContaining({ code: "CSCA_REVOKED", severity: "critical" }));
  });

  it("signale une signature SOD invalide en critique", () => {
    const findings = detectAnomalies({
      trustChain: { ...baseTrustChain, sodSignatureValid: false },
      mrzValidation: validMrz,
      documentExpectedToSupportAaOrCa: false,
      lostStolenCheck: baseLostStolenCheck,
    });
    expect(findings).toContainEqual(expect.objectContaining({ code: "SOD_SIGNATURE_INVALID", severity: "critical" }));
  });

  it("signale un DSC non signé par le CSCA de confiance en critique", () => {
    const findings = detectAnomalies({
      trustChain: { ...baseTrustChain, dscTrustedByCsca: false },
      mrzValidation: validMrz,
      documentExpectedToSupportAaOrCa: false,
      lostStolenCheck: baseLostStolenCheck,
    });
    expect(findings).toContainEqual(expect.objectContaining({ code: "DSC_NOT_TRUSTED_BY_CSCA", severity: "critical" }));
  });

  it("ne signale pas DSC_NOT_TRUSTED_BY_CSCA quand aucune ancre de confiance n'est disponible (déjà couvert par NO_TRUST_ANCHOR)", () => {
    const findings = detectAnomalies({
      trustChain: { ...baseTrustChain, noTrustAnchorAvailable: true, dscTrustedByCsca: false },
      mrzValidation: validMrz,
      documentExpectedToSupportAaOrCa: false,
      lostStolenCheck: baseLostStolenCheck,
    });
    expect(findings.some((f) => f.code === "DSC_NOT_TRUSTED_BY_CSCA")).toBe(false);
    expect(findings).toContainEqual(expect.objectContaining({ code: "NO_TRUST_ANCHOR", severity: "critical" }));
  });

  it("signale un DSC hors période de validité en critique", () => {
    const findings = detectAnomalies({
      trustChain: { ...baseTrustChain, dscWithinValidityPeriod: false },
      mrzValidation: validMrz,
      documentExpectedToSupportAaOrCa: false,
      lostStolenCheck: baseLostStolenCheck,
    });
    expect(findings).toContainEqual(expect.objectContaining({ code: "DSC_EXPIRED", severity: "critical" }));
  });

  it("signale en avertissement l'absence de vérification de révocation (aucune CRL disponible)", () => {
    const findings = detectAnomalies({
      trustChain: { ...baseTrustChain, revocationChecked: false },
      mrzValidation: validMrz,
      documentExpectedToSupportAaOrCa: false,
      lostStolenCheck: baseLostStolenCheck,
    });
    expect(findings).toContainEqual(expect.objectContaining({ code: "REVOCATION_NOT_CHECKED", severity: "warning" }));
  });

  it("ne signale pas REVOCATION_NOT_CHECKED quand aucune ancre de confiance n'est disponible (déjà couvert par NO_TRUST_ANCHOR)", () => {
    const findings = detectAnomalies({
      trustChain: { ...baseTrustChain, noTrustAnchorAvailable: true, revocationChecked: false },
      mrzValidation: validMrz,
      documentExpectedToSupportAaOrCa: false,
      lostStolenCheck: baseLostStolenCheck,
    });
    expect(findings.some((f) => f.code === "REVOCATION_NOT_CHECKED")).toBe(false);
  });

  it("signale un chiffre de contrôle composite MRZ invalide en critique", () => {
    const findings = detectAnomalies({
      trustChain: baseTrustChain,
      mrzValidation: { ...validMrz, compositeValid: false },
      documentExpectedToSupportAaOrCa: false,
      lostStolenCheck: baseLostStolenCheck,
    });
    expect(findings).toContainEqual(expect.objectContaining({ code: "MRZ_COMPOSITE_INVALID", severity: "critical" }));
  });

  it("signale un CSCA proche de l'expiration en info", () => {
    const findings = detectAnomalies({
      trustChain: baseTrustChain,
      mrzValidation: validMrz,
      documentExpectedToSupportAaOrCa: false,
      cscaExpiresWithinDays: 30,
      lostStolenCheck: baseLostStolenCheck,
    });
    expect(findings).toContainEqual(expect.objectContaining({ code: "CSCA_EXPIRING_SOON", severity: "info" }));
  });

  it("ne signale rien pour un CSCA qui expire dans plus de 90 jours", () => {
    const findings = detectAnomalies({
      trustChain: baseTrustChain,
      mrzValidation: validMrz,
      documentExpectedToSupportAaOrCa: false,
      cscaExpiresWithinDays: 200,
      lostStolenCheck: baseLostStolenCheck,
    });
    expect(findings.some((f) => f.code === "CSCA_EXPIRING_SOON")).toBe(false);
  });

  describe("Active/Chip Authentication", () => {
    it("signale l'absence d'AA en avertissement quand le document devrait la supporter", () => {
      const findings = detectAnomalies({
        trustChain: baseTrustChain,
        mrzValidation: validMrz,
        documentExpectedToSupportAaOrCa: true,
        lostStolenCheck: baseLostStolenCheck,
      });
      expect(findings).toContainEqual(expect.objectContaining({ code: "MISSING_ACTIVE_CHIP_AUTH", severity: "warning" }));
    });

    it("ne signale rien pour l'absence d'AA sur un document qui ne devrait pas la supporter", () => {
      const findings = detectAnomalies({
        trustChain: baseTrustChain,
        mrzValidation: validMrz,
        documentExpectedToSupportAaOrCa: false,
        lostStolenCheck: baseLostStolenCheck,
      });
      expect(findings.some((f) => f.code === "MISSING_ACTIVE_CHIP_AUTH")).toBe(false);
    });

    it("signale un échec de vérification AA en critique (indice de clonage) — plus grave qu'une simple absence", () => {
      const findings = detectAnomalies({
        trustChain: baseTrustChain,
        mrzValidation: validMrz,
        documentExpectedToSupportAaOrCa: true,
        activeAuthentication: { supported: true, valid: false },
        lostStolenCheck: baseLostStolenCheck,
      });
      expect(findings).toContainEqual(
        expect.objectContaining({ code: "ACTIVE_AUTHENTICATION_FAILED", severity: "critical" }),
      );
      expect(findings.some((f) => f.code === "MISSING_ACTIVE_CHIP_AUTH")).toBe(false);
    });

    it("ne signale aucune anomalie quand l'AA est présente et valide", () => {
      const findings = detectAnomalies({
        trustChain: baseTrustChain,
        mrzValidation: validMrz,
        documentExpectedToSupportAaOrCa: true,
        activeAuthentication: { supported: true, valid: true },
        lostStolenCheck: baseLostStolenCheck,
      });
      expect(findings).toHaveLength(0);
    });

    it("signale un algorithme AA non supporté en info, sans le traiter comme un échec de vérification", () => {
      const findings = detectAnomalies({
        trustChain: baseTrustChain,
        mrzValidation: validMrz,
        documentExpectedToSupportAaOrCa: true,
        activeAuthentication: { supported: false, valid: false, reason: "RSA non supporté" },
        lostStolenCheck: baseLostStolenCheck,
      });
      expect(findings).toContainEqual(
        expect.objectContaining({ code: "ACTIVE_AUTHENTICATION_UNSUPPORTED_ALGORITHM", severity: "info" }),
      );
      expect(findings.some((f) => f.code === "ACTIVE_AUTHENTICATION_FAILED")).toBe(false);
    });
  });

  describe("Statut perdu/volé", () => {
    it("signale un document déclaré perdu ou volé en critique", () => {
      const findings = detectAnomalies({
        trustChain: baseTrustChain,
        mrzValidation: validMrz,
        documentExpectedToSupportAaOrCa: false,
        lostStolenCheck: { checked: true, reported: true },
      });
      expect(findings).toContainEqual(
        expect.objectContaining({ code: "DOCUMENT_REPORTED_LOST_OR_STOLEN", severity: "critical" }),
      );
    });

    it("signale en avertissement un statut perdu/volé non vérifiable, sans le traiter comme non signalé", () => {
      const findings = detectAnomalies({
        trustChain: baseTrustChain,
        mrzValidation: validMrz,
        documentExpectedToSupportAaOrCa: false,
        lostStolenCheck: { checked: false, reported: false },
      });
      expect(findings).toContainEqual(
        expect.objectContaining({ code: "LOST_STOLEN_STATUS_NOT_CHECKED", severity: "warning" }),
      );
      expect(findings.some((f) => f.code === "DOCUMENT_REPORTED_LOST_OR_STOLEN")).toBe(false);
    });

    it("ne signale rien quand le registre a bien été interrogé et que le document n'est pas signalé", () => {
      const findings = detectAnomalies({
        trustChain: baseTrustChain,
        mrzValidation: validMrz,
        documentExpectedToSupportAaOrCa: false,
        lostStolenCheck: { checked: true, reported: false },
      });
      expect(findings.some((f) => f.code === "LOST_STOLEN_STATUS_NOT_CHECKED")).toBe(false);
      expect(findings.some((f) => f.code === "DOCUMENT_REPORTED_LOST_OR_STOLEN")).toBe(false);
    });
  });

  it("cumule plusieurs anomalies indépendantes simultanément", () => {
    const findings = detectAnomalies({
      trustChain: { ...baseTrustChain, dataGroupHashMismatches: [2], revoked: true },
      mrzValidation: { ...validMrz, compositeValid: false },
      documentExpectedToSupportAaOrCa: true,
      lostStolenCheck: baseLostStolenCheck,
    });
    const codes = findings.map((f) => f.code).sort();
    expect(codes).toEqual(
      ["CSCA_REVOKED", "DG_HASH_MISMATCH", "MISSING_ACTIVE_CHIP_AUTH", "MRZ_COMPOSITE_INVALID"].sort(),
    );
  });
});
