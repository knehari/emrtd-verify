import { Controller, Get } from "@nestjs/common";
import { HealthCheck, HealthCheckError, HealthCheckService, type HealthIndicatorResult } from "@nestjs/terminus";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { PrismaService } from "../prisma/prisma.service";

@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Liveness : process-level uniquement, aucune dépendance externe. Une panne de Postgres/Redis
   * ne doit jamais faire échouer /health — sinon un orchestrateur (Kubernetes) redémarrerait
   * en boucle un conteneur API par ailleurs sain à cause d'une dépendance en panne, aggravant
   * l'incident au lieu de le contenir. C'est le rôle de /ready.
   */
  @Get("health")
  liveness(): { status: "ok" } {
    return { status: "ok" };
  }

  /** Readiness : dépendances externes (DB, Redis). Dégrade explicitement plutôt que de planter. */
  @Get("ready")
  @HealthCheck()
  readiness() {
    return this.health.check([() => this.checkDatabase(), () => this.checkRedis()]);
  }

  private async checkDatabase(): Promise<HealthIndicatorResult> {
    const reachable = await this.prisma.isReachable();
    const result: HealthIndicatorResult = { database: { status: reachable ? "up" : "down" } };
    if (!reachable) {
      throw new HealthCheckError("Base de données injoignable", result);
    }
    return result;
  }

  private async checkRedis(): Promise<HealthIndicatorResult> {
    const redisUrl = this.config.get<string>("REDIS_URL") ?? "redis://localhost:6379";
    // Connexion dédiée et éphémère plutôt que de réutiliser celle de BullMQ : /ready doit
    // rester un signal indépendant de l'état interne de la file de vérification.
    const client = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1000 });
    try {
      await client.connect();
      await client.ping();
      return { redis: { status: "up" } };
    } catch (error) {
      throw new HealthCheckError("Redis injoignable", { redis: { status: "down", message: String(error) } });
    } finally {
      client.disconnect();
    }
  }
}
