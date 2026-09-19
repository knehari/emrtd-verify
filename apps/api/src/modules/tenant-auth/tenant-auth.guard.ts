import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { TenantAuthService, type TenantSessionPayload } from "./tenant-auth.service";

declare module "fastify" {
  interface FastifyRequest {
    tenantUser?: TenantSessionPayload;
  }
}

/**
 * Authentifie chaque requête `/portal/*` via le cookie httpOnly `tenant_session` et attache la
 * session résolue à la requête. `tenantUser.kycClientId` est la frontière d'isolation
 * multi-tenant STRICTE de tout le module tenant-api (voir tenant-api.module.ts) : chaque requête
 * scope systématiquement ses lectures/écritures à ce `kycClientId`, jamais à un identifiant fourni
 * par le corps de la requête ou l'URL — un tenant ne doit jamais pouvoir lire les données d'un
 * autre en falsifiant un paramètre (voir docs/threat-model.md).
 */
@Injectable()
export class TenantAuthGuard implements CanActivate {
  constructor(private readonly tenantAuth: TenantAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = request.cookies?.tenant_session;

    if (!token) {
      throw new UnauthorizedException("Authentification tenant requise");
    }

    try {
      request.tenantUser = await this.tenantAuth.verifyToken(token);
      return true;
    } catch {
      throw new UnauthorizedException("Session tenant invalide ou expirée");
    }
  }
}
