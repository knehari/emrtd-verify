import { Module } from "@nestjs/common";
import { VerificationController } from "./verification.controller";
import { VerificationService } from "./verification.service";
import { AnomalyDetectionService } from "../anomaly-detection/anomaly-detection.service";
import { FaceMatchClient } from "../face-match/face-match.client";

@Module({
  controllers: [VerificationController],
  providers: [VerificationService, AnomalyDetectionService, FaceMatchClient],
  exports: [VerificationService],
})
export class VerificationModule {}
