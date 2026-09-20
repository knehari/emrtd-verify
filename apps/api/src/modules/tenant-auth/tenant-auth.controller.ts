import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { FastifyReply, FastifyRequest } from "fastify";
import { TenantAuthService } from "./tenant-auth.service";
import { TenantAuthGuard } from "./tenant-auth.guard";
import { TenantLoginDto } from "./dto/tenant-login.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { TwoFactorCodeDto } from "./dto/two-factor-code.dto";
import { VerifyTwoFactorChallengeDto } from "./dto/verify-two-factor-challenge.dto";
import { DisableTwoFactorDto } from "./dto/disable-two-factor.dto";

export const TENANT_SESSION_COOKIE = "tenant_session";
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

/** Authentification web des comptes tenant (apps/tenant-portal) — voir docs/tenant-portal.md. */
@Controller("portal/auth")
export class TenantAuthController {
  constructor(private readonly tenantAuth: TenantAuthService) {}

  /**
   * 5 tentatives/minute/IP — même raisonnement que AdminAuthController.login. Si le compte a le
   * 2FA activé, aucun cookie n'est posé ici — voir "2fa/verify" pour la seconde étape.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: TenantLoginDto, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.tenantAuth.login(dto.email, dto.password);
    if (result.requiresTwoFactor) {
      return { requiresTwoFactor: true, challengeToken: result.challengeToken };
    }

    reply.setCookie(TENANT_SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return { requiresTwoFactor: false, tenantUser: result.tenantUser };
  }

  /** Seconde étape du login quand le compte a le 2FA activé — même limite que "login". */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("2fa/verify")
  @HttpCode(HttpStatus.OK)
  async verifyTwoFactor(@Body() dto: VerifyTwoFactorChallengeDto, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.tenantAuth.verifyTwoFactorChallenge(dto.challengeToken, dto.code);

    reply.setCookie(TENANT_SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return { tenantUser: result.tenantUser };
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.clearCookie(TENANT_SESSION_COOKIE, { path: "/" });
  }

  @UseGuards(TenantAuthGuard)
  @Get("me")
  async me(@Req() request: FastifyRequest) {
    const tenantUser = await this.tenantAuth.getProfile(request.tenantUser!.sub);
    return { tenantUser };
  }

  /** Changement de mot de passe en libre-service — voir docs/tenant-portal.md "Sécurité du compte". */
  @UseGuards(TenantAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("change-password")
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(@Req() request: FastifyRequest, @Body() dto: ChangePasswordDto) {
    await this.tenantAuth.changePassword(request.tenantUser!.sub, dto.currentPassword, dto.newPassword);
  }

  @UseGuards(TenantAuthGuard)
  @Post("2fa/setup")
  @HttpCode(HttpStatus.OK)
  async setupTwoFactor(@Req() request: FastifyRequest) {
    return this.tenantAuth.setupTwoFactor(request.tenantUser!.sub);
  }

  @UseGuards(TenantAuthGuard)
  @Post("2fa/enable")
  @HttpCode(HttpStatus.NO_CONTENT)
  async enableTwoFactor(@Req() request: FastifyRequest, @Body() dto: TwoFactorCodeDto) {
    await this.tenantAuth.enableTwoFactor(request.tenantUser!.sub, dto.code);
  }

  @UseGuards(TenantAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("2fa/disable")
  @HttpCode(HttpStatus.NO_CONTENT)
  async disableTwoFactor(@Req() request: FastifyRequest, @Body() dto: DisableTwoFactorDto) {
    await this.tenantAuth.disableTwoFactor(request.tenantUser!.sub, dto.password);
  }
}
