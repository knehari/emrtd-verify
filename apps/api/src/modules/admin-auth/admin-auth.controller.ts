import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AdminAuthService } from "./admin-auth.service";
import { AdminAuthGuard } from "./admin-auth.guard";
import { AdminLoginDto } from "./dto/admin-login.dto";

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
   * bourrage d'identifiants (credential stuffing), voir docs/threat-model.md.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: AdminLoginDto, @Res({ passthrough: true }) reply: FastifyReply) {
    const { token, admin } = await this.adminAuth.login(dto.email, dto.password);

    reply.setCookie(ADMIN_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return { admin };
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.clearCookie(ADMIN_SESSION_COOKIE, { path: "/" });
  }

  @UseGuards(AdminAuthGuard)
  @Get("me")
  me(@Req() request: FastifyRequest) {
    return { admin: request.adminUser };
  }
}
