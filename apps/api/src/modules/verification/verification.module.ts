import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { VerificationController } from "./verification.controller";
import { VerificationService } from "./verification.service";
import { ResultSignerService } from "./result-signer.service";
import { LivenessChallengeService } from "./liveness-challenge.service";
import { KycModule } from "../kyc/kyc.module";

/**
 * Côté API HTTP du parcours de vérification : reçoit la requête, authentifie le client KYC,
 * met la vérification en file (BullMQ, `VerificationService.submit`) et répond immédiatement.
 * Le traitement effectif (chaîne de confiance PKI, anomalies, face-match, verdict, persistance)
 * tourne dans le processus worker séparé — voir VerificationWorkerModule et
 * docs/roadmap.md Phase 6 "processus séparé". `BullModule.registerQueue` ici n'enregistre que le
 * producteur (aucun `@Processor` dans ce module) ; les deux processus partagent la même file
 * Redis nommée "verification".
 */
@Module({
  imports: [BullModule.registerQueue({ name: "verification" }), KycModule],
  controllers: [VerificationController],
  providers: [VerificationService, ResultSignerService, LivenessChallengeService],
  exports: [VerificationService, ResultSignerService, LivenessChallengeService],
})
export class VerificationModule {}
