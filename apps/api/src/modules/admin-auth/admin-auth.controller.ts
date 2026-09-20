import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AdminAuthService } from "./admin-auth.service";
import { AdminAuthGuard } from "./admin-auth.guard";
import { AdminLoginDto } from "./dto/admin-login.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { TwoFactorCodeDto } from "./dto/two-factor-code.dto";
import { VerifyTwoFactorChallengeDto } from "./dto/verify-two-factor-challenge.dto";
import { DisableTwoFactorDto } from "./dto/disable-two-factor.dto";

export const ADMIN_SESSION_COOKIE = "admin_session";
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

/**
 * Authentification web des administrateurs internes SaaS (apps/admin-web) — voir
 * docs/admin-web.md. Session par cookie httpOnly (jamais accessible en JS, protège contre le
 * vol de jeton par XSS) plutôt qu'un jeton renvoyé dans le corps de la réponse.
 */
@Controller("admin/auth")
export class AdminAuthController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  /**
   * 5 tentatives/minute/IP — bien plus strict que la limite globale (100/min, voir
   * ThrottlerModule dans app.module.ts) : un endpoint de login est une cible directe pour le
   * bourrage d'identifiants (credential stuffing), voir docs/threat-model.md. Si le compte a le
   * 2FA activé, aucun cookie n'est posé ici — voir "2fa/verify" pour la seconde étape.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: AdminLoginDto, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.adminAuth.login(dto.email, dto.password);
    if (result.requiresTwoFactor) {
      return { requiresTwoFactor: true, challengeToken: result.challengeToken };
    }

    reply.setCookie(ADMIN_SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return { requiresTwoFactor: false, admin: result.admin };
  }

  /** Seconde étape du login quand le compte a le 2FA activé — même limite que "login". */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("2fa/verify")
  @HttpCode(HttpStatus.OK)
  async verifyTwoFactor(@Body() dto: VerifyTwoFactorChallengeDto, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.adminAuth.verifyTwoFactorChallenge(dto.challengeToken, dto.code);

    reply.setCookie(ADMIN_SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return { admin: result.admin };
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.clearCookie(ADMIN_SESSION_COOKIE, { path: "/" });
  }

  @UseGuards(AdminAuthGuard)
  @Get("me")
  async me(@Req() request: FastifyRequest) {
    const admin = await this.adminAuth.getProfile(request.adminUser!.sub);
    return { admin };
  }

  /** Changement de mot de passe en libre-service — voir docs/admin-web.md "Sécurité du compte". */
  @UseGuards(AdminAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("change-password")
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(@Req() request: FastifyRequest, @Body() dto: ChangePasswordDto) {
    await this.adminAuth.changePassword(request.adminUser!.sub, dto.currentPassword, dto.newPassword);
  }

  @UseGuards(AdminAuthGuard)
  @Post("2fa/setup")
  @HttpCode(HttpStatus.OK)
  async setupTwoFactor(@Req() request: FastifyRequest) {
    return this.adminAuth.setupTwoFactor(request.adminUser!.sub);
  }

  @UseGuards(AdminAuthGuard)
  @Post("2fa/enable")
  @HttpCode(HttpStatus.NO_CONTENT)
  async enableTwoFactor(@Req() request: FastifyRequest, @Body() dto: TwoFactorCodeDto) {
    await this.adminAuth.enableTwoFactor(request.adminUser!.sub, dto.code);
  }

  @UseGuards(AdminAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("2fa/disable")
  @HttpCode(HttpStatus.NO_CONTENT)
  async disableTwoFactor(@Req() request: FastifyRequest, @Body() dto: DisableTwoFactorDto) {
    await this.adminAuth.disableTwoFactor(request.adminUser!.sub, dto.password);
  }
}
