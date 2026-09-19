import type { ConfigService } from "@nestjs/config";
import IORedis from "ioredis";

/**
 * Configuration de connexion Redis partagée par `BullModule.forRootAsync`, utilisée à la fois
 * par le processus API (producteur, `app.module.ts`) et le processus worker (consommateur,
 * `worker.module.ts`) — voir docs/roadmap.md Phase 6 "processus séparé".
 */
export function bullmqConnectionFactory(config: ConfigService) {
  return {
    connection: new IORedis(config.get<string>("REDIS_URL") ?? "redis://localhost:6379", {
      // Exigé par BullMQ pour ses commandes bloquantes (Workers) — voir doc BullMQ "Connections".
      maxRetriesPerRequest: null,
    }),
  };
}
