import { describe, it, expect } from "vitest";
import { MetricsController } from "../../src/modules/metrics/metrics.controller";
import { MetricsService } from "../../src/modules/metrics/metrics.service";

describe("MetricsController", () => {
  it("renvoie le texte Prometheus produit par MetricsService", async () => {
    const metrics = new MetricsService();
    metrics.recordVerification("authentic", "FRA");
    const controller = new MetricsController(metrics);

    const body = await controller.getMetrics();
    expect(body).toContain('emrtd_verifications_total{verdict="authentic",issuing_country="FRA"} 1');
  });
});
