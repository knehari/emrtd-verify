import "reflect-metadata";
import { createServer } from "node:http";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { WorkerModule } from "./worker.module";
import { MetricsService } from "./modules/metrics/metrics.service";

/**
 * Processus worker BullMQ, séparé du processus API HTTP (voir main.ts) — voir
 * docs/roadmap.md Phase 6 "processus séparé". Pas de serveur Fastify/Nest HTTP complet ici :
 * uniquement `NestFactory.createApplicationContext` (résolution DI + BullMQ Worker via
 * `@Processor`) et un petit listener HTTP brut pour `/metrics`, ce processus ayant sa propre
 * instance de MetricsService (compteurs de verdicts/anomalies/chaîne de confiance produits par
 * VerificationProcessor, qui tourne ici, pas dans le processus API — voir
 * modules/metrics/metrics.service.ts).
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const logger = app.get(Logger);
  const metrics = app.get(MetricsService);

  const metricsPort = Number(process.env.WORKER_METRICS_PORT ?? 3001);
  const metricsServer = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/metrics") {
      metrics
        .getMetricsText()
        .then((body) => {
          res.writeHead(200, { "Content-Type": metrics.contentType });
          res.end(body);
        })
        .catch((error) => {
          logger.error(`Échec de la génération des métriques Prometheus : ${String(error)}`);
          res.writeHead(500);
          res.end();
        });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  metricsServer.listen(metricsPort, "0.0.0.0");

  logger.log(`Worker BullMQ démarré — file "verification" consommée, métriques sur :${metricsPort}/metrics`);
}

bootstrap();
