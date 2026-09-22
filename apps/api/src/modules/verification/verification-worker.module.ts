import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { VerificationProcessor } from "./verification.processor";
import { ResultSignerService } from "./result-signer.service";
import { LivenessChallengeService } from "./liveness-challenge.service";
import { LivenessReplayGuardService } from "./liveness-replay-guard.service";
import { DeviceAttestationService } from "./device-attestation.service";
import { AnomalyDetectionService } from "../anomaly-detection/anomaly-detection.service";
import { FaceMatchClient } from "../face-match/face-match.client";
import { PkiTrustModule } from "../pki/pki-trust.module";
import { AuditModule } from "../audit/audit.module";
import { MetricsModule } from "../metrics/metrics.module";
import { VerifiedPersonModule } from "../verified-person/verified-person.module";
import { DocumentStatusModule } from "../document-status/document-status.module";

/**
 * Côté worker BullMQ du parcours de vérification : consomme la file "verification" et exécute
 * le traitement complet (`VerificationProcessor.process`) — chaîne de confiance PKI, détection
 * d'anomalies, comparaison faciale, verdict, signature, persistance, rapprochement
 * VerifiedPerson (voir VerifiedPersonModule, docs/tenant-portal.md). Tourne dans le processus
 * worker séparé (`worker.module.ts`), jamais dans le processus API HTTP — voir
 * docs/roadmap.md Phase 6 "processus séparé". N'importe que le chemin de LECTURE de la confiance
 * PKI (`PkiTrustModule`), jamais `CscaSyncModule` (réservé au processus API, voir ce module).
 */
@Module({
  imports: [BullModule.registerQueue({ name: "verification" }), PkiTrustModule, AuditModule, MetricsModule, VerifiedPersonModule, DocumentStatusModule],
  providers: [
    VerificationProcessor,
    AnomalyDetectionService,
    FaceMatchClient,
    ResultSignerService,
    LivenessChallengeService,
    LivenessReplayGuardService,
    DeviceAttestationService,
  ],
})
export class VerificationWorkerModule {}
