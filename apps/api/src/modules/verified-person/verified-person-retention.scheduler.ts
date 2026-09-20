import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import { VerifiedPersonService } from "./verified-person.service";

/**
 * Purge/anonymisation automatisée dédiée à `VerifiedPerson` — voir docs/gdpr-compliance.md
 * "Rétention" et docs/tenant-portal.md "Rétention des données et VerifiedPerson". Contrairement à
 * RetentionSchedulerService (AuditModule, `DATA_RETENTION_DAYS`, défaut 30 jours), ce planificateur
 * n'a AUCUNE valeur par défaut : `VerifiedPerson` est délibérément conçu pour survivre à la purge
 * des VerificationRecord individuels (utilité "à surveiller" dans la durée), donc choisir une
 * période de rétention arbitraire ici serait une décision de politique, pas un détail technique —
 * elle doit être déterminée par une AIPD/DPIA complète (non réalisée en v1, voir roadmap.md), pas
 * supposée par cette plateforme. Tant que `VERIFIED_PERSON_RETENTION_DAYS` n'est pas configuré,
 * ce job ne fait rien.
 */
@Injectable()
export class VerifiedPersonRetentionScheduler {
  private readonly logger = new Logger(VerifiedPersonRetentionScheduler.name);

  constructor(
    private readonly verifiedPersonService: VerifiedPersonService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async anonymizeExpiredVerifiedPersons(): Promise<void> {
    const retentionDays = this.resolveRetentionDays();
    if (retentionDays === null) {
      return;
    }

    try {
      const { anonymizedCount } = await this.verifiedPersonService.anonymizeExpired(retentionDays);
      if (anonymizedCount > 0) {
        this.logger.log(
          `Anonymisation VerifiedPerson : ${anonymizedCount} fiche(s) inactive(s) au-delà de ${retentionDays} jours anonymisée(s)`,
        );
      }
    } catch (error) {
      // Un échec ne doit jamais faire planter le processus — nouvelle tentative au prochain
      // déclenchement planifié (le lendemain), même principe que RetentionSchedulerService.
      this.logger.error(`Anonymisation VerifiedPerson échouée : ${String(error)}`);
    }
  }

  /** `null` désactive le job — voir la note de justification en tête de classe. */
  private resolveRetentionDays(): number | null {
    const raw = this.config.get<string>("VERIFIED_PERSON_RETENTION_DAYS");
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
}
