import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { VerificationController } from "./verification.controller";
import { VerificationService } from "./verification.service";
import { VerificationProcessor } from "./verification.processor";
import { ResultSignerService } from "./result-signer.service";
import { AnomalyDetectionService } from "../anomaly-detection/anomaly-detection.service";
import { FaceMatchClient } from "../face-match/face-match.client";
import { PkiTrustModule } from "../pki/pki-trust.module";
import { AuditModule } from "../audit/audit.module";
import { KycModule } from "../kyc/kyc.module";

@Module({
  imports: [BullModule.registerQueue({ name: "verification" }), PkiTrustModule, AuditModule, KycModule],
  controllers: [VerificationController],
  providers: [VerificationService, VerificationProcessor, AnomalyDetectionService, FaceMatchClient, ResultSignerService],
  exports: [VerificationService, ResultSignerService],
})
export class VerificationModule {}
