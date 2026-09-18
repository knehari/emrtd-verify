import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import { AuditService } from "./audit.service";

const DEFAULT_RETENTION_DAYS = 30;

/**
 * Déclenche quotidiennement la purge des vérifications au-delà de `DATA_RETENTION_DAYS`
 * (voir docs/gdpr-compliance.md "Rétention"). Le mécanisme de purge (AuditService.purgeExpired)
 * existait déjà pour le droit à l'effacement à la demande ; ce planificateur en fait la
 * politique de rétention par défaut, sans intervention manuelle.
 */
@Injectable()
export class RetentionSchedulerService {
  private readonly logger = new Logger(RetentionSchedulerService.name);

  constructor(
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpiredRecords(): Promise<void> {
    const retentionDays = this.resolveRetentionDays();
    try {
      const { purgedVerificationCount } = await this.auditService.purgeExpired(retentionDays);
      if (purgedVerificationCount > 0) {
        this.logger.log(
          `Purge de rétention : ${purgedVerificationCount} vérification(s) au-delà de ${retentionDays} jours supprimée(s)`,
        );
      }
    } catch (error) {
      // Une purge en échec ne doit jamais faire planter le processus API — nouvelle tentative
      // au prochain déclenchement planifié (le lendemain).
      this.logger.error(`Purge de rétention échouée : ${String(error)}`);
    }
  }

  private resolveRetentionDays(): number {
    const raw = this.config.get<string>("DATA_RETENTION_DAYS");
    const parsed = raw ? Number(raw) : DEFAULT_RETENTION_DAYS;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS;
  }
}
