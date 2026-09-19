import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";

export const ADMIN_ROLES_KEY = "adminRoles";

/** Restreint une route admin à un sous-ensemble de rôles (ex. `@RequireAdminRole("SUPER_ADMIN")`). */
export const RequireAdminRole = (...roles: Array<"SUPER_ADMIN" | "SUPPORT">) => SetMetadata(ADMIN_ROLES_KEY, roles);

/**
 * S'applique APRÈS AdminAuthGuard (qui peuple `request.adminUser`) — voir
 * admin-web.md "Rôles". Sans `@RequireAdminRole(...)` sur une route, toute session admin
 * authentifiée passe (comportement par défaut : SUPPORT et SUPER_ADMIN).
 */
@Injectable()
export class AdminRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<Array<"SUPER_ADMIN" | "SUPPORT">>(ADMIN_ROLES_KEY, context.getHandler());
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const role = request.adminUser?.role;
    if (!role || !requiredRoles.includes(role)) {
      throw new ForbiddenException("Rôle administrateur insuffisant pour cette action");
    }
    return true;
  }
}
