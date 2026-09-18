import { Module } from "@nestjs/common";
import { TrustCacheService } from "./trust-cache.service";
import { PkiTrustService } from "./pki-trust.service";

/**
 * Regroupe la validation de chaîne de confiance PKI et son cache d'ancres CSCA — consommé par
 * VerificationModule (voir docs/pki-trust-model.md).
 */
@Module({
  providers: [TrustCacheService, PkiTrustService],
  exports: [TrustCacheService, PkiTrustService],
})
export class PkiTrustModule {}
