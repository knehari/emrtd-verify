import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { VerificationController } from "./verification.controller";
import { VerificationService } from "./verification.service";
import { VerificationProcessor } from "./verification.processor";
import { AnomalyDetectionService } from "../anomaly-detection/anomaly-detection.service";
import { FaceMatchClient } from "../face-match/face-match.client";
import { PkiTrustModule } from "../pki/pki-trust.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [BullModule.registerQueue({ name: "verification" }), PkiTrustModule, AuditModule],
  controllers: [VerificationController],
  providers: [VerificationService, VerificationProcessor, AnomalyDetectionService, FaceMatchClient],
  exports: [VerificationService],
})
export class VerificationModule {}
