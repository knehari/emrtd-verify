import { Controller, Get, Header } from "@nestjs/common";
import { MetricsService } from "./metrics.service";

/**
 * Endpoint de scraping Prometheus — volontairement non authentifié (comme /health et /ready,
 * conforme aux conventions d'observabilité usuelles) : n'expose que des compteurs agrégés sans
 * donnée personnelle ni identifiant de vérification (voir MetricsService). En production, cet
 * endpoint doit rester restreint au réseau interne (scraper Prometheus), pas exposé publiquement
 * — mesure opérationnelle, hors du périmètre de ce code applicatif.
 */
@Controller("metrics")
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  async getMetrics(): Promise<string> {
    return this.metrics.getMetricsText();
  }
}
