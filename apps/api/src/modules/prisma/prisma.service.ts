import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * Client Prisma partagé — connexion établie/fermée avec le cycle de vie du module Nest
 * (pattern standard NestJS). `@Global()` sur PrismaModule évite d'avoir à ré-importer ce
 * provider dans chaque module qui persiste des données.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    // Ne jamais laisser une base de données temporairement injoignable empêcher tout le
    // processus API de démarrer (donc /health lui-même, qui doit rester indépendant — voir
    // HealthController) : Prisma se reconnecte de toute façon paresseusement à la première
    // requête, cette connexion "eager" n'est qu'une optimisation, pas une condition de démarrage.
    try {
      await this.$connect();
    } catch (error) {
      this.logger.warn(`Connexion initiale à la base de données échouée, nouvelle tentative à la première requête : ${String(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Utilisé par le contrôle de disponibilité (`GET /ready`) — voir HealthModule. */
  async isReachable(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.warn(`Base de données injoignable : ${String(error)}`);
      return false;
    }
  }
}
