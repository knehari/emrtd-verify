import { Module } from "@nestjs/common";
import { TenantAuthModule } from "../tenant-auth/tenant-auth.module";
import { TenantVerifiedPersonsController } from "./tenant-verified-persons.controller";
import { TenantVerifiedPersonsService } from "./tenant-verified-persons.service";
import { TenantVerificationsController } from "./tenant-verifications.controller";
import { TenantVerificationsService } from "./tenant-verifications.service";

/**
 * Surface d'API du portail tenant (apps/tenant-portal) : stats, liste/détail des "clients"
 * (VerifiedPerson), revue des vérifications — toutes strictement scopées au tenant connecté,
 * voir TenantAuthGuard et docs/tenant-portal.md.
 */
@Module({
  imports: [TenantAuthModule],
  controllers: [TenantVerifiedPersonsController, TenantVerificationsController],
  providers: [TenantVerifiedPersonsService, TenantVerificationsService],
})
export class TenantApiModule {}
