import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { VerificationProcessor } from "./verification.processor";
import { ResultSignerService } from "./result-signer.service";
import { AnomalyDetectionService } from "../anomaly-detection/anomaly-detection.service";
import { FaceMatchClient } from "../face-match/face-match.client";
import { PkiTrustModule } from "../pki/pki-trust.module";
import { AuditModule } from "../audit/audit.module";
import { MetricsModule } from "../metrics/metrics.module";

/**
 * Côté worker BullMQ du parcours de vérification : consomme la file "verification" et exécute
 * le traitement complet (`VerificationProcessor.process`) — chaîne de confiance PKI, détection
 * d'anomalies, comparaison faciale, verdict, signature, persistance. Tourne dans le processus
 * worker séparé (`worker.module.ts`), jamais dans le processus API HTTP — voir
 * docs/roadmap.md Phase 6 "processus séparé". N'importe que le chemin de LECTURE de la confiance
 * PKI (`PkiTrustModule`), jamais `CscaSyncModule` (réservé au processus API, voir ce module).
 */
@Module({
  imports: [BullModule.registerQueue({ name: "verification" }), PkiTrustModule, AuditModule, MetricsModule],
  providers: [VerificationProcessor, AnomalyDetectionService, FaceMatchClient, ResultSignerService],
})
export class VerificationWorkerModule {}
