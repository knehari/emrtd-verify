import { Module } from "@nestjs/common";
import { PkiTrustModule } from "./pki-trust.module";
import { KycModule } from "../kyc/kyc.module";
import { CscaBundleService } from "./csca-bundle.service";
import { CscaBundleSignerService } from "./csca-bundle-signer.service";
import { PkiTrustController } from "./pki-trust.controller";

/**
 * Distribution HTTP du bundle CSCA hors ligne au mobile (voir PkiTrustController et
 * docs/pki-trust-model.md "Vérification hors ligne"). Importé UNIQUEMENT par le processus API
 * (`app.module.ts`), jamais par le worker BullMQ (`worker.module.ts`) : ce module expose un
 * contrôleur HTTP, qui n'a aucun sens dans un processus sans adaptateur HTTP complet — même
 * principe de séparation que CscaSyncModule (voir ce module et docs/roadmap.md Phase 6 "processus
 * séparé").
 */
@Module({
  imports: [PkiTrustModule, KycModule],
  controllers: [PkiTrustController],
  providers: [CscaBundleService, CscaBundleSignerService],
})
export class CscaBundleModule {}
