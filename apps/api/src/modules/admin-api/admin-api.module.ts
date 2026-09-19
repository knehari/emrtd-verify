import { Module } from "@nestjs/common";
import { AdminAuthModule } from "../admin-auth/admin-auth.module";
import { AdminKycClientsController } from "./admin-kyc-clients.controller";
import { AdminKycClientsService } from "./admin-kyc-clients.service";
import { AdminUsersController } from "./admin-users.controller";
import { AdminUsersService } from "./admin-users.service";
import { AdminVerificationsController } from "./admin-verifications.controller";
import { AdminVerificationsService } from "./admin-verifications.service";

/**
 * Surface d'administration interne SaaS (apps/admin-web) : CRUD tenants (KycClient), CRUD
 * comptes administrateurs, revue globale des vérifications — voir docs/admin-web.md. Toutes
 * les routes sont gardées par AdminAuthGuard/AdminRolesGuard (voir AdminAuthModule).
 */
@Module({
  imports: [AdminAuthModule],
  controllers: [AdminKycClientsController, AdminUsersController, AdminVerificationsController],
  providers: [AdminKycClientsService, AdminUsersService, AdminVerificationsService],
})
export class AdminApiModule {}
