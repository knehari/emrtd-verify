import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { BullModule } from "@nestjs/bullmq";
import { ScheduleModule } from "@nestjs/schedule";
import { VerificationModule } from "./modules/verification/verification.module";
import { KycModule } from "./modules/kyc/kyc.module";
import { AuditModule } from "./modules/audit/audit.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { PkiTrustModule } from "./modules/pki/pki-trust.module";
import { CscaSyncModule } from "./modules/pki/csca-sync.module";
import { HealthModule } from "./modules/health/health.module";
import { MetricsModule } from "./modules/metrics/metrics.module";
import { AdminAuthModule } from "./modules/admin-auth/admin-auth.module";
import { TenantAuthModule } from "./modules/tenant-auth/tenant-auth.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { bullmqConnectionFactory } from "./common/bullmq-connection.factory";

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
      useFactory: bullmqConnectionFactory,
    }),
    PrismaModule,
    PkiTrustModule,
    CscaSyncModule,
    HealthModule,
    MetricsModule,
    VerificationModule,
    KycModule,
    AuditModule,
    AdminAuthModule,
    TenantAuthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
