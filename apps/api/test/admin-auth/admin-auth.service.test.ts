import { describe, it, expect, vi } from "vitest";
import { JwtService } from "@nestjs/jwt";
import { AdminAuthService } from "../../src/modules/admin-auth/admin-auth.service";
import { hashPassword } from "../../src/common/security/password-hasher";

function buildService(admin: { id: string; email: string; passwordHash: string; role: "SUPER_ADMIN" | "SUPPORT"; active: boolean } | null) {
  const findUnique = vi.fn().mockResolvedValue(admin);
  const update = vi.fn().mockResolvedValue(undefined);
  const prisma = { adminUser: { findUnique, update } } as never;
  const jwt = new JwtService({ secret: "test-admin-secret", signOptions: { expiresIn: "12h" } });
  return { service: new AdminAuthService(prisma, jwt), findUnique, update, jwt };
}

describe("AdminAuthService.login", () => {
  it("émet un jeton valide pour des identifiants corrects", async () => {
    const passwordHash = await hashPassword("correct-password-123");
    const { service, update } = buildService({ id: "admin-1", email: "ops@example.org", passwordHash, role: "SUPER_ADMIN", active: true });

    const result = await service.login("ops@example.org", "correct-password-123");

    expect(result.admin).toEqual({ id: "admin-1", email: "ops@example.org", role: "SUPER_ADMIN" });
    expect(result.token.length).toBeGreaterThan(0);
    expect(update).toHaveBeenCalledWith({ where: { id: "admin-1" }, data: { lastLoginAt: expect.any(Date) } });
  });

  it("rejette un mot de passe incorrect", async () => {
    const passwordHash = await hashPassword("correct-password-123");
    const { service } = buildService({ id: "admin-1", email: "ops@example.org", passwordHash, role: "SUPPORT", active: true });

    await expect(service.login("ops@example.org", "wrong-password")).rejects.toThrow("Identifiants invalides");
  });

  it("rejette un compte désactivé même avec le bon mot de passe", async () => {
    const passwordHash = await hashPassword("correct-password-123");
    const { service } = buildService({ id: "admin-1", email: "ops@example.org", passwordHash, role: "SUPPORT", active: false });

    await expect(service.login("ops@example.org", "correct-password-123")).rejects.toThrow("Identifiants invalides");
  });

  it("rejette un email inconnu sans lever d'exception différente (pas de fuite d'existence de compte)", async () => {
    const { service } = buildService(null);
    await expect(service.login("inconnu@example.org", "anything")).rejects.toThrow("Identifiants invalides");
  });
});

describe("AdminAuthService.verifyToken", () => {
  it("vérifie un jeton émis par login()", async () => {
    const passwordHash = await hashPassword("correct-password-123");
    const { service } = buildService({ id: "admin-1", email: "ops@example.org", passwordHash, role: "SUPER_ADMIN", active: true });

    const { token } = await service.login("ops@example.org", "correct-password-123");
    const payload = await service.verifyToken(token);

    expect(payload).toMatchObject({ sub: "admin-1", email: "ops@example.org", role: "SUPER_ADMIN", typ: "admin" });
  });

  it("rejette un jeton signé avec un autre secret (ex. un jeton tenant)", async () => {
    const { service } = buildService(null);
    const otherJwt = new JwtService({ secret: "different-secret" });
    const foreignToken = await otherJwt.signAsync({ sub: "x", typ: "admin" });

    await expect(service.verifyToken(foreignToken)).rejects.toThrow();
  });
});
