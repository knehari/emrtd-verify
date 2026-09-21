import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard";
import { AdminRolesGuard } from "../admin-auth/admin-roles.guard";
import { AdminVerificationsService } from "./admin-verifications.service";
import { ListVerificationsQueryDto } from "./dto/list-verifications-query.dto";
import { ReviewVerificationDto } from "./dto/review-verification.dto";

/**
 * Revue globale des vérifications, tous tenants confondus — voir AdminVerificationsService.
 * `review` n'a volontairement aucun `@RequireAdminRole(...)` : SUPPORT et SUPER_ADMIN peuvent
 * tous deux faire de la revue manuelle (voir le commentaire sur AdminRole, schema.prisma).
 */
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

  @Post(":verificationId/review")
  review(@Req() request: FastifyRequest, @Param("verificationId") verificationId: string, @Body() dto: ReviewVerificationDto) {
    return this.service.review(verificationId, request.adminUser!.sub, dto);
  }
}
