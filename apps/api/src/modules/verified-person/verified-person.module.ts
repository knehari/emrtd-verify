import { Module } from "@nestjs/common";
import { VerifiedPersonService } from "./verified-person.service";
import { VerifiedPersonRetentionScheduler } from "./verified-person-retention.scheduler";

/**
 * Voir VerifiedPersonService. Consommé par VerificationWorkerModule (écriture, à chaque
 * vérification traitée) et par AppModule (lecture via l'API tenant/admin, et pour que
 * VerifiedPersonRetentionScheduler tourne dans le processus API HTTP — seul processus où
 * `ScheduleModule.forRoot()` est enregistré, voir app.module.ts ; sans lui un `@Cron` ne se
 * déclenche jamais, même déclaré).
 */
@Module({
  providers: [VerifiedPersonService, VerifiedPersonRetentionScheduler],
  exports: [VerifiedPersonService],
})
export class VerifiedPersonModule {}
