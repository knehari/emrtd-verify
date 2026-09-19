import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard";
import { AdminRolesGuard } from "../admin-auth/admin-roles.guard";
import { AdminVerificationsService } from "./admin-verifications.service";
import { ListVerificationsQueryDto } from "./dto/list-verifications-query.dto";

/** Revue globale des vérifications, tous tenants confondus — voir AdminVerificationsService. */
@Controller("admin/verifications")
@UseGuards(AdminAuthGuard, AdminRolesGuard)
export class AdminVerificationsController {
  constructor(private readonly service: AdminVerificationsService) {}

  @Get()
  list(@Query() query: ListVerificationsQueryDto) {
    return this.service.list(query);
  }

  @Get(":verificationId")
  get(@Param("verificationId") verificationId: string) {
    return this.service.get(verificationId);
  }
}
