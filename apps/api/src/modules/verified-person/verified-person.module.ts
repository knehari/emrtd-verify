import { Module } from "@nestjs/common";
import { VerifiedPersonService } from "./verified-person.service";

/**
 * Voir VerifiedPersonService. Consommé par VerificationWorkerModule (écriture, à chaque
 * vérification traitée) et par le futur module d'API tenant (lecture/consultation, Phase 1e).
 */
@Module({
  providers: [VerifiedPersonService],
  exports: [VerifiedPersonService],
})
export class VerifiedPersonModule {}
