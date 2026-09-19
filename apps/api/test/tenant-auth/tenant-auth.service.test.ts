import { describe, it, expect, vi } from "vitest";
import { JwtService } from "@nestjs/jwt";
import { TenantAuthService } from "../../src/modules/tenant-auth/tenant-auth.service";
import { hashPassword } from "../../src/common/security/password-hasher";

function buildService(
  tenantUser: { id: string; email: string; passwordHash: string; kycClientId: string; role: "OWNER" | "MEMBER"; active: boolean } | null,
) {
  const findUnique = vi.fn().mockResolvedValue(tenantUser);
  const update = vi.fn().mockResolvedValue(undefined);
  const prisma = { tenantUser: { findUnique, update } } as never;
  const jwt = new JwtService({ secret: "test-tenant-secret", signOptions: { expiresIn: "12h" } });
  return { service: new TenantAuthService(prisma, jwt), findUnique, update };
}

describe("TenantAuthService.login", () => {
  it("émet un jeton scopé au tenant pour des identifiants corrects", async () => {
    const passwordHash = await hashPassword("correct-password-123");
    const { service } = buildService({
      id: "tu-1",
      email: "ops@acme.example",
      passwordHash,
      kycClientId: "kyc-client-1",
      role: "OWNER",
      active: true,
    });

    const { token, tenantUser } = await service.login("ops@acme.example", "correct-password-123");

    expect(tenantUser).toEqual({ id: "tu-1", email: "ops@acme.example", kycClientId: "kyc-client-1", role: "OWNER" });
    const payload = await service.verifyToken(token);
    expect(payload).toMatchObject({ sub: "tu-1", kycClientId: "kyc-client-1", role: "OWNER", typ: "tenant" });
  });

  it("rejette un compte désactivé", async () => {
    const passwordHash = await hashPassword("correct-password-123");
    const { service } = buildService({
      id: "tu-1",
      email: "ops@acme.example",
      passwordHash,
      kycClientId: "kyc-client-1",
      role: "MEMBER",
      active: false,
    });

    await expect(service.login("ops@acme.example", "correct-password-123")).rejects.toThrow("Identifiants invalides");
  });

  it("rejette un jeton admin présenté comme jeton tenant (typ différent)", async () => {
    const { service } = buildService(null);
    const adminLikeJwt = new JwtService({ secret: "test-tenant-secret" });
    const token = await adminLikeJwt.signAsync({ sub: "x", typ: "admin" });

    await expect(service.verifyToken(token)).rejects.toThrow("Jeton de session invalide");
  });
});
