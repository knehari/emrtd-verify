import { Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { CscaSyncService } from "./csca-sync.service";

/**
 * Déclenche la synchronisation quotidienne de la CSCA Master List (voir CscaSyncService).
 * Décalé de RetentionSchedulerService (3h) pour ne pas concurrencer deux jobs de fond en même
 * temps sur une instance à faibles ressources.
 */
@Injectable()
export class CscaSyncScheduler {
  constructor(private readonly cscaSync: CscaSyncService) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async run(): Promise<void> {
    // CscaSyncService.sync() gère déjà ses propres erreurs (journalisation + MasterListSyncRun) ;
    // rien à faire ici sauf déclencher, jamais laisser une exception remonter au scheduler.
    await this.cscaSync.sync();
  }
}
