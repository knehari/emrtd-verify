import { Injectable } from "@nestjs/common";
import type { Verdict } from "@emrtd-verify/shared-types";

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
  async record(_entry: AuditEntry): Promise<void> {
    throw new Error("Non implémenté : persistance du journal d'audit (PostgreSQL, append-only). Voir docs/roadmap.md.");
  }

  /** Purge anticipée pour une vérification donnée — support du droit à l'effacement. */
  async purge(_verificationId: string): Promise<void> {
    throw new Error("Non implémenté : purge anticipée. Voir docs/gdpr-compliance.md \"Droits des personnes\".");
  }
}
