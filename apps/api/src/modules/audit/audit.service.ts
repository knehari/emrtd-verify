import { Injectable } from "@nestjs/common";
import type { Verdict } from "@emrtd-verify/shared-types";
import { PrismaService } from "../prisma/prisma.service";

export interface AuditEntry {
  verificationId: string;
  clientId: string;
  verdict: Verdict;
  trustChainSource: string;
  anomalyCodes: string[];
  occurredAt: string; // ISO 8601
}

/**
 * Journal d'audit append-only — ne contient jamais de donnée biométrique brute
 * ni de champ d'identité complet, uniquement le fait qu'une vérification a eu lieu
 * et son verdict (voir docs/gdpr-compliance.md "Rétention" et "Sécurité").
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    // INSERT uniquement : aucune méthode update() n'est exposée par ce service, pour préserver
    // le caractère append-only du journal (seule purge() peut retirer une ligne, voir plus bas).
    await this.prisma.auditLogEntry.create({
      data: {
        verificationId: entry.verificationId,
        clientId: entry.clientId,
        verdict: entry.verdict,
        trustChainSource: entry.trustChainSource,
        anomalyCodes: entry.anomalyCodes,
        occurredAt: new Date(entry.occurredAt),
      },
    });
  }

  /**
   * Purge anticipée pour une vérification donnée — support du droit à l'effacement
   * (voir docs/gdpr-compliance.md "Droits des personnes"). Supprime à la fois le résultat
   * persisté (VerificationRecord) et les entrées du journal d'audit correspondantes.
   * `deleteMany` est idempotent (aucune ligne trouvée n'est pas une erreur), ce qui permet
   * de rappeler cette méthode sans risque en cas de retentative côté appelant.
   */
  async purge(verificationId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.auditLogEntry.deleteMany({ where: { verificationId } }),
      this.prisma.verificationRecord.deleteMany({ where: { verificationId } }),
    ]);
  }

  /**
   * Purge automatisée par politique de rétention (voir docs/gdpr-compliance.md "Rétention",
   * `DATA_RETENTION_DAYS`) — appelée quotidiennement par RetentionSchedulerService. Transaction
   * interactive (et non un simple deleteMany en cascade) car AuditLogEntry n'a pas de clé
   * étrangère vers VerificationRecord.createdAt : il faut d'abord résoudre les identifiants
   * expirés côté VerificationRecord avant de purger les deux tables de façon cohérente.
   */
  async purgeExpired(retentionDays: number): Promise<{ purgedVerificationCount: number }> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    return this.prisma.$transaction(async (tx) => {
      const expired = await tx.verificationRecord.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { verificationId: true },
      });
      const verificationIds = expired.map((record) => record.verificationId);
      if (verificationIds.length === 0) {
        return { purgedVerificationCount: 0 };
      }

      await tx.auditLogEntry.deleteMany({ where: { verificationId: { in: verificationIds } } });
      await tx.verificationRecord.deleteMany({ where: { verificationId: { in: verificationIds } } });

      return { purgedVerificationCount: verificationIds.length };
    });
  }
}
