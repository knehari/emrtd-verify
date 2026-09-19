import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { TenantAuthGuard } from "../tenant-auth/tenant-auth.guard";
import { TenantVerificationsService } from "./tenant-verifications.service";
import { ListTenantVerificationsQueryDto } from "./dto/list-tenant-verifications-query.dto";

/** Revue des vérifications du tenant connecté — voir TenantVerificationsService. */
@Controller("portal/verifications")
@UseGuards(TenantAuthGuard)
export class TenantVerificationsController {
  constructor(private readonly service: TenantVerificationsService) {}

  @Get()
  list(@Req() request: FastifyRequest, @Query() query: ListTenantVerificationsQueryDto) {
    return this.service.list(request.tenantUser!.kycClientId, query);
  }

  @Get(":verificationId")
  get(@Req() request: FastifyRequest, @Param("verificationId") verificationId: string) {
    return this.service.get(request.tenantUser!.kycClientId, verificationId);
  }
}
