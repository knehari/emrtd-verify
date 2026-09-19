import { Module } from "@nestjs/common";
import { TrustCacheService } from "./trust-cache.service";
import { PkiTrustService } from "./pki-trust.service";
import { CscaStoreService } from "./csca-store.service";

/**
 * Chemin de LECTURE de la confiance PKI (validation de chaîne + cache d'ancres CSCA) —
 * ne fait jamais de réseau, uniquement des lectures DB/cache (voir PkiTrustService). Importé à
 * la fois par le processus API (VerificationModule) et par le processus worker BullMQ
 * (VerificationWorkerModule) : voir docs/roadmap.md Phase 6 "processus séparé". La
 * synchronisation périodique de la Master List (réseau) vit à part dans CscaSyncModule, pour
 * n'être exécutée que par un seul processus (voir docs/pki-trust-model.md).
 */
@Module({
  providers: [TrustCacheService, PkiTrustService, CscaStoreService],
  exports: [TrustCacheService, PkiTrustService],
})
export class PkiTrustModule {}
