import { describe, it, expect } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AdminRolesGuard } from "../../src/modules/admin-auth/admin-roles.guard";

function buildContext(adminUser: { role?: "SUPER_ADMIN" | "SUPPORT" } | undefined, requiredRoles: string[] | undefined) {
  const reflector = new Reflector();
  reflector.get = () => requiredRoles as never;
  const guard = new AdminRolesGuard(reflector);
  const context = {
    getHandler: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ adminUser }) }),
  } as never;
  return { guard, context };
}

describe("AdminRolesGuard", () => {
  it("laisse passer sans restriction déclarée (@RequireAdminRole absent)", () => {
    const { guard, context } = buildContext({ role: "SUPPORT" }, undefined);
    expect(guard.canActivate(context)).toBe(true);
  });

  it("laisse passer un rôle autorisé", () => {
    const { guard, context } = buildContext({ role: "SUPER_ADMIN" }, ["SUPER_ADMIN"]);
    expect(guard.canActivate(context)).toBe(true);
  });

  it("rejette un rôle non autorisé (SUPPORT sur une route SUPER_ADMIN)", () => {
    const { guard, context } = buildContext({ role: "SUPPORT" }, ["SUPER_ADMIN"]);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it("rejette une requête sans adminUser (garde AdminAuthGuard pas exécutée avant)", () => {
    const { guard, context } = buildContext(undefined, ["SUPER_ADMIN"]);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
