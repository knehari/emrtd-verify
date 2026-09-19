import { Injectable } from "@nestjs/common";
import { Counter, Histogram, Registry } from "prom-client";
import type { AnomalySeverity, TrustLevel, TrustSourceKind, Verdict } from "@emrtd-verify/shared-types";

/**
 * Métriques applicatives (Prometheus) — voir docs/roadmap.md Phase 6 "Observabilité". Cardinalité
 * volontairement bornée sur toutes les étiquettes (verdict/pays/code d'anomalie/sévérité/source de
 * confiance) : jamais d'identifiant de vérification, de client KYC ni de donnée personnelle en
 * étiquette, pour rester sûr d'exposer sur un endpoint /metrics non authentifié (voir
 * MetricsController) sans risque de fuite ni d'explosion de cardinalité.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  private readonly verificationsTotal = new Counter({
    name: "emrtd_verifications_total",
    help: "Nombre de vérifications traitées, par verdict et pays émetteur.",
    labelNames: ["verdict", "issuing_country"] as const,
    registers: [this.registry],
  });

  private readonly anomaliesTotal = new Counter({
    name: "emrtd_anomalies_total",
    help: "Nombre d'anomalies détectées, par code et sévérité.",
    labelNames: ["code", "severity"] as const,
    registers: [this.registry],
  });

  private readonly trustChainTotal = new Counter({
    name: "emrtd_trust_chain_total",
    help: "Nombre de chaînes de confiance PKI résolues, par source et niveau.",
    labelNames: ["source", "level"] as const,
    registers: [this.registry],
  });

  private readonly processingDurationSeconds = new Histogram({
    name: "emrtd_verification_processing_duration_seconds",
    help: "Durée de traitement d'une vérification de bout en bout (VerificationProcessor.process).",
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
    registers: [this.registry],
  });

  recordVerification(verdict: Verdict, issuingCountry: string): void {
    this.verificationsTotal.inc({ verdict, issuing_country: issuingCountry });
  }

  recordAnomaly(code: string, severity: AnomalySeverity): void {
    this.anomaliesTotal.inc({ code, severity });
  }

  recordTrustChain(source: TrustSourceKind, level: TrustLevel): void {
    this.trustChainTotal.inc({ source, level });
  }

  observeProcessingDuration(seconds: number): void {
    this.processingDurationSeconds.observe(seconds);
  }

  async getMetricsText(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
