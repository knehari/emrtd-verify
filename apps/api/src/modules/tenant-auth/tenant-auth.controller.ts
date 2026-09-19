import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { FastifyReply, FastifyRequest } from "fastify";
import { TenantAuthService } from "./tenant-auth.service";
import { TenantAuthGuard } from "./tenant-auth.guard";
import { TenantLoginDto } from "./dto/tenant-login.dto";

export const TENANT_SESSION_COOKIE = "tenant_session";
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

/** Authentification web des comptes tenant (apps/tenant-portal) — voir docs/tenant-portal.md. */
@Controller("portal/auth")
export class TenantAuthController {
  constructor(private readonly tenantAuth: TenantAuthService) {}

  /** 5 tentatives/minute/IP — même raisonnement que AdminAuthController.login. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: TenantLoginDto, @Res({ passthrough: true }) reply: FastifyReply) {
    const { token, tenantUser } = await this.tenantAuth.login(dto.email, dto.password);

    reply.setCookie(TENANT_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return { tenantUser };
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.clearCookie(TENANT_SESSION_COOKIE, { path: "/" });
  }

  @UseGuards(TenantAuthGuard)
  @Get("me")
  me(@Req() request: FastifyRequest) {
    return { tenantUser: request.tenantUser };
  }
}
