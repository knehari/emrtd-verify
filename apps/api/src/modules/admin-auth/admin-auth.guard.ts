import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AdminAuthService, type AdminSessionPayload } from "./admin-auth.service";

declare module "fastify" {
  interface FastifyRequest {
    adminUser?: AdminSessionPayload;
  }
}

/**
 * Authentifie chaque requête `/admin/*` via le cookie httpOnly `admin_session` (voir
 * AdminAuthController.login) et attache la session résolue à la requête — même principe que
 * KycApiKeyGuard, cookie de session plutôt que clé API puisque c'est un humain qui se connecte
 * depuis un navigateur (apps/admin-web), pas un système tiers.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly adminAuth: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = request.cookies?.admin_session;

    if (!token) {
      throw new UnauthorizedException("Authentification administrateur requise");
    }

    try {
      request.adminUser = await this.adminAuth.verifyToken(token);
      return true;
    } catch {
      throw new UnauthorizedException("Session administrateur invalide ou expirée");
    }
  }
}
