import { Module } from "@nestjs/common";
import { CscaSyncService } from "./csca-sync.service";
import { CscaSyncScheduler } from "./csca-sync.scheduler";

/**
 * Chemin d'ÉCRITURE de la confiance PKI : synchronisation réseau périodique de la CSCA Master
 * List ICAO PKD (voir CscaSyncService) et son déclencheur planifié quotidien (CscaSyncScheduler).
 * Importé UNIQUEMENT par le processus API (`app.module.ts`), jamais par le worker BullMQ
 * (`worker.module.ts`) : faire tourner ce module dans deux processus dupliquerait les appels
 * réseau vers l'ICAO PKD/LDAP et les écritures DB à chaque exécution planifiée — voir
 * docs/roadmap.md Phase 6 "processus séparé" et docs/pki-trust-model.md.
 */
@Module({
  providers: [CscaSyncService, CscaSyncScheduler],
  exports: [CscaSyncService],
})
export class CscaSyncModule {}
