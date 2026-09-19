import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { TenantAuthGuard } from "../tenant-auth/tenant-auth.guard";
import { TenantVerifiedPersonsService } from "./tenant-verified-persons.service";
import { ListVerifiedPersonsQueryDto } from "./dto/list-verified-persons-query.dto";
import { UpdateVerifiedPersonDto } from "./dto/update-verified-person.dto";

/**
 * Consultation/gestion des "clients" (VerifiedPerson) du tenant connecté — voir
 * TenantVerifiedPersonsService. `stats` déclarée AVANT `:id` (même raison que
 * VerificationController "signing-key" : ne pas être interprétée comme un identifiant).
 */
@Controller("portal/verified-persons")
@UseGuards(TenantAuthGuard)
export class TenantVerifiedPersonsController {
  constructor(private readonly service: TenantVerifiedPersonsService) {}

  @Get("stats")
  stats(@Req() request: FastifyRequest) {
    return this.service.stats(request.tenantUser!.kycClientId);
  }

  @Get()
  list(@Req() request: FastifyRequest, @Query() query: ListVerifiedPersonsQueryDto) {
    return this.service.list(request.tenantUser!.kycClientId, query);
  }

  @Get(":id")
  get(@Req() request: FastifyRequest, @Param("id") id: string) {
    return this.service.get(request.tenantUser!.kycClientId, id);
  }

  @Patch(":id")
  updateStatus(@Req() request: FastifyRequest, @Param("id") id: string, @Body() dto: UpdateVerifiedPersonDto) {
    return this.service.updateStatus(request.tenantUser!.kycClientId, id, dto);
  }
}
