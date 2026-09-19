import { Module } from "@nestjs/common";
import { TrustCacheService } from "./trust-cache.service";
import { PkiTrustService } from "./pki-trust.service";
import { CscaStoreService } from "./csca-store.service";
import { CscaSyncService } from "./csca-sync.service";
import { CscaSyncScheduler } from "./csca-sync.scheduler";

/**
 * Regroupe la validation de chaîne de confiance PKI, son cache d'ancres CSCA, et la
 * synchronisation périodique de la CSCA Master List ICAO PKD — consommé par VerificationModule
 * (voir docs/pki-trust-model.md).
 */
@Module({
  providers: [TrustCacheService, PkiTrustService, CscaStoreService, CscaSyncService, CscaSyncScheduler],
  exports: [TrustCacheService, PkiTrustService, CscaSyncService],
})
export class PkiTrustModule {}
