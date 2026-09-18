import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { BullModule } from "@nestjs/bullmq";
import { ScheduleModule } from "@nestjs/schedule";
import IORedis from "ioredis";
import { VerificationModule } from "./modules/verification/verification.module";
import { KycModule } from "./modules/kyc/kyc.module";
import { AuditModule } from "./modules/audit/audit.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { PkiTrustModule } from "./modules/pki/pki-trust.module";
import { HealthModule } from "./modules/health/health.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === "production" ? "info" : "debug",
        transport:
          process.env.NODE_ENV === "production"
            ? undefined
            : { target: "pino-pretty", options: { singleLine: true } },
        // Ne jamais journaliser un jeton d'authentification en clair (voir docs/threat-model.md).
        redact: ["req.headers.authorization", "req.headers['x-api-key']"],
      },
    }),
    ThrottlerModule.forRoot([
      {
        // 100 req/min/IP : le pipeline (validation de chaîne PKI + appel services/face-match)
        // est coûteux en I/O et en dépendances externes — une limite globale simple protège
        // contre l'abus applicatif en attendant une politique de quota par client KYC.
        ttl: 60_000,
        limit: 100,
      },
    ]),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: new IORedis(config.get<string>("REDIS_URL") ?? "redis://localhost:6379", {
          // Exigé par BullMQ pour ses commandes bloquantes (Workers) — voir doc BullMQ "Connections".
          maxRetriesPerRequest: null,
        }),
      }),
    }),
    PrismaModule,
    PkiTrustModule,
    HealthModule,
    VerificationModule,
    KycModule,
    AuditModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
