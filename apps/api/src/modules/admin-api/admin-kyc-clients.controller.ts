import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard";
import { AdminRolesGuard, RequireAdminRole } from "../admin-auth/admin-roles.guard";
import { AdminKycClientsService } from "./admin-kyc-clients.service";
import { CreateKycClientDto } from "./dto/create-kyc-client.dto";
import { UpdateKycClientDto } from "./dto/update-kyc-client.dto";

/**
 * CRUD des tenants (KycClient) — voir AdminKycClientsService. Créer/modifier/suspendre un
 * tenant ou faire tourner sa clé API sont réservés à SUPER_ADMIN (décision commerciale/
 * sécurité, voir la réponse retenue dans docs/roadmap.md) ; la simple consultation reste
 * ouverte à SUPPORT.
 */
@Controller("admin/kyc-clients")
@UseGuards(AdminAuthGuard, AdminRolesGuard)
export class AdminKycClientsController {
  constructor(private readonly service: AdminKycClientsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get(":clientId")
  get(@Param("clientId") clientId: string) {
    return this.service.get(clientId);
  }

  @RequireAdminRole("SUPER_ADMIN")
  @Post()
  create(@Body() dto: CreateKycClientDto) {
    return this.service.create(dto);
  }

  @RequireAdminRole("SUPER_ADMIN")
  @Patch(":clientId")
  update(@Param("clientId") clientId: string, @Body() dto: UpdateKycClientDto) {
    return this.service.update(clientId, dto);
  }

  @RequireAdminRole("SUPER_ADMIN")
  @Post(":clientId/rotate-key")
  rotateApiKey(@Param("clientId") clientId: string) {
    return this.service.rotateApiKey(clientId);
  }
}
