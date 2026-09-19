import { describe, it, expect, beforeEach } from "vitest";
import { MetricsService } from "../../src/modules/metrics/metrics.service";

describe("MetricsService", () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
  });

  it("expose un texte au format Prometheus avec le content-type attendu", async () => {
    expect(service.contentType).toContain("text/plain");
    const text = await service.getMetricsText();
    expect(text).toContain("# HELP emrtd_verifications_total");
    expect(text).toContain("# HELP emrtd_anomalies_total");
    expect(text).toContain("# HELP emrtd_trust_chain_total");
    expect(text).toContain("# HELP emrtd_verification_processing_duration_seconds");
  });

  it("incrémente le compteur de vérifications par verdict et pays émetteur", async () => {
    service.recordVerification("authentic", "FRA");
    service.recordVerification("authentic", "FRA");
    service.recordVerification("rejected", "USA");

    const text = await service.getMetricsText();
    expect(text).toContain('emrtd_verifications_total{verdict="authentic",issuing_country="FRA"} 2');
    expect(text).toContain('emrtd_verifications_total{verdict="rejected",issuing_country="USA"} 1');
  });

  it("incrémente le compteur d'anomalies par code et sévérité", async () => {
    service.recordAnomaly("MRZ_CHECK_DIGIT_INVALID", "critical");

    const text = await service.getMetricsText();
    expect(text).toContain('emrtd_anomalies_total{code="MRZ_CHECK_DIGIT_INVALID",severity="critical"} 1');
  });

  it("incrémente le compteur de chaînes de confiance par source et niveau", async () => {
    service.recordTrustChain("icao-pkd", "high");

    const text = await service.getMetricsText();
    expect(text).toContain('emrtd_trust_chain_total{source="icao-pkd",level="high"} 1');
  });

  it("enregistre une observation de durée de traitement dans l'histogramme", async () => {
    service.observeProcessingDuration(1.5);

    const text = await service.getMetricsText();
    expect(text).toContain("emrtd_verification_processing_duration_seconds_sum 1.5");
    expect(text).toContain("emrtd_verification_processing_duration_seconds_count 1");
  });

  it("n'expose aucune valeur de champ personnel ni identifiant de vérification dans les libellés", async () => {
    service.recordVerification("authentic", "FRA");
    service.recordAnomaly("FACE_MATCH_UNAVAILABLE", "warning");
    service.recordTrustChain("national-pkd", "medium");

    const text = await service.getMetricsText();
    expect(text).not.toMatch(/verificationId/i);
    expect(text).not.toMatch(/documentNumber/i);
  });
});
