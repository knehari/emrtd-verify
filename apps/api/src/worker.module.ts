import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { BullModule } from "@nestjs/bullmq";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { VerificationWorkerModule } from "./modules/verification/verification-worker.module";
import { bullmqConnectionFactory } from "./common/bullmq-connection.factory";

/**
 * Racine du processus worker BullMQ, distinct du processus API HTTP (`app.module.ts`/`main.ts`)
 * — voir docs/roadmap.md Phase 6 "processus séparé" pour permettre un scaling horizontal
 * indépendant de l'API. Ne comporte volontairement AUCUN module HTTP (pas de ThrottlerModule,
 * pas d'adaptateur Fastify) : ce processus n'expose que la consommation de la file "verification"
 * et un petit listener HTTP minimal pour `/metrics` (voir worker.ts), pas une API REST complète.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === "production" ? "info" : "debug",
        transport:
          process.env.NODE_ENV === "production"
            ? undefined
            : { target: "pino-pretty", options: { singleLine: true } },
      },
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: bullmqConnectionFactory,
    }),
    PrismaModule,
    VerificationWorkerModule,
  ],
})
export class WorkerModule {}
