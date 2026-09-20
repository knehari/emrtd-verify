import { describe, it, expect, vi } from "vitest";
import { JwtService } from "@nestjs/jwt";
import { AdminAuthService } from "../../src/modules/admin-auth/admin-auth.service";
import { hashPassword } from "../../src/common/security/password-hasher";
import { generateTotpCode, generateTotpSecret } from "../../src/common/security/totp";

type FakeAdmin = {
  id: string;
  email: string;
  passwordHash: string;
  role: "SUPER_ADMIN" | "SUPPORT";
  active: boolean;
  totpSecret: string | null;
  totpEnabled: boolean;
};

/** Fake Prisma à état mutable — nécessaire pour tester setup -> enable -> login 2FA en un seul test (voir README des tests précédents pour la convention "fake Prisma"). */
function buildService(admin: FakeAdmin | null) {
  const state = admin ? { ...admin } : null;
  const findUnique = vi.fn(async () => (state ? { ...state } : null));
  const update = vi.fn(async ({ data }: { data: Partial<FakeAdmin> }) => {
    if (state) Object.assign(state, data);
    return state ? { ...state } : null;
  });
  const prisma = { adminUser: { findUnique, update } } as never;
  const jwt = new JwtService({ secret: "test-admin-secret", signOptions: { expiresIn: "12h" } });
  return { service: new AdminAuthService(prisma, jwt), findUnique, update, state };
}

function fakeAdmin(overrides: Partial<FakeAdmin> = {}): FakeAdmin {
  return {
    id: "admin-1",
    email: "ops@example.org",
    passwordHash: "",
    role: "SUPER_ADMIN",
    active: true,
    totpSecret: null,
    totpEnabled: false,
    ...overrides,
  };
}

describe("AdminAuthService.login", () => {
  it("émet un jeton valide pour des identifiants corrects (sans 2FA)", async () => {
    const passwordHash = await hashPassword("correct-password-123");
    const { service, update } = buildService(fakeAdmin({ passwordHash }));

    const result = await service.login("ops@example.org", "correct-password-123");

    expect(result.requiresTwoFactor).toBe(false);
    if (result.requiresTwoFactor) throw new Error("unreachable");
    expect(result.admin).toEqual({ id: "admin-1", email: "ops@example.org", role: "SUPER_ADMIN" });
    expect(result.token.length).toBeGreaterThan(0);
    expect(update).toHaveBeenCalledWith({ where: { id: "admin-1" }, data: { lastLoginAt: expect.any(Date) } });
  });

  it("rejette un mot de passe incorrect", async () => {
    const passwordHash = await hashPassword("correct-password-123");
    const { service } = buildService(fakeAdmin({ passwordHash, role: "SUPPORT" }));

    await expect(service.login("ops@example.org", "wrong-password")).rejects.toThrow("Identifiants invalides");
  });

  it("rejette un compte désactivé même avec le bon mot de passe", async () => {
    const passwordHash = await hashPassword("correct-password-123");
    const { service } = buildService(fakeAdmin({ passwordHash, role: "SUPPORT", active: false }));

    await expect(service.login("ops@example.org", "correct-password-123")).rejects.toThrow("Identifiants invalides");
  });

  it("rejette un email inconnu sans lever d'exception différente (pas de fuite d'existence de compte)", async () => {
    const { service } = buildService(null);
    await expect(service.login("inconnu@example.org", "anything")).rejects.toThrow("Identifiants invalides");
  });

  it("renvoie un jeton de défi 2FA (sans poser de session) quand totpEnabled est vrai", async () => {
    const passwordHash = await hashPassword("correct-password-123");
    const secret = generateTotpSecret();
    const { service } = buildService(fakeAdmin({ passwordHash, totpSecret: secret, totpEnabled: true }));

    const result = await service.login("ops@example.org", "correct-password-123");

    expect(result.requiresTwoFactor).toBe(true);
    if (!result.requiresTwoFactor) throw new Error("unreachable");
    expect(result.challengeToken.length).toBeGreaterThan(0);
  });
});

describe("AdminAuthService.verifyTwoFactorChallenge", () => {
  it("finalise la session avec un code TOTP valide", async () => {
    const passwordHash = await hashPassword("correct-password-123");
    const secret = generateTotpSecret();
    const { service } = buildService(fakeAdmin({ passwordHash, totpSecret: secret, totpEnabled: true }));

    const loginResult = await service.login("ops@example.org", "correct-password-123");
    if (!loginResult.requiresTwoFactor) throw new Error("unreachable");

    const code = await generateTotpCode(secret);
    const result = await service.verifyTwoFactorChallenge(loginResult.challengeToken, code);

    expect(result.admin).toEqual({ id: "admin-1", email: "ops@example.org", role: "SUPER_ADMIN" });
    const payload = await service.verifyToken(result.token);
    expect(payload).toMatchObject({ sub: "admin-1", typ: "admin" });
  });

  it("rejette un code TOTP invalide", async () => {
    const passwordHash = await hashPassword("correct-password-123");
    const secret = generateTotpSecret();
    const { service } = buildService(fakeAdmin({ passwordHash, totpSecret: secret, totpEnabled: true }));

    const loginResult = await service.login("ops@example.org", "correct-password-123");
    if (!loginResult.requiresTwoFactor) throw new Error("unreachable");

    await expect(service.verifyTwoFactorChallenge(loginResult.challengeToken, "000000")).rejects.toThrow("Code de vérification invalide");
  });

  it("rejette un jeton de session (typ admin) présenté comme jeton de défi", async () => {
    const passwordHash = await hashPassword("correct-password-123");
    const { service } = buildService(fakeAdmin({ passwordHash }));

    const loginResult = await service.login("ops@example.org", "correct-password-123");
    if (loginResult.requiresTwoFactor) throw new Error("unreachable");

    await expect(service.verifyTwoFactorChallenge(loginResult.token, "123456")).rejects.toThrow("Jeton de vérification invalide");
  });
});

describe("AdminAuthService.verifyToken", () => {
  it("vérifie un jeton émis par login()", async () => {
    const passwordHash = await hashPassword("correct-password-123");
    const { service } = buildService(fakeAdmin({ passwordHash }));

    const result = await service.login("ops@example.org", "correct-password-123");
    if (result.requiresTwoFactor) throw new Error("unreachable");
    const payload = await service.verifyToken(result.token);

    expect(payload).toMatchObject({ sub: "admin-1", email: "ops@example.org", role: "SUPER_ADMIN", typ: "admin" });
  });

  it("rejette un jeton signé avec un autre secret (ex. un jeton tenant)", async () => {
    const { service } = buildService(null);
    const otherJwt = new JwtService({ secret: "different-secret" });
    const foreignToken = await otherJwt.signAsync({ sub: "x", typ: "admin" });

    await expect(service.verifyToken(foreignToken)).rejects.toThrow();
  });
});

describe("AdminAuthService.changePassword", () => {
  it("met à jour le hash quand le mot de passe actuel est correct", async () => {
    const passwordHash = await hashPassword("old-password-123");
    const { service, state } = buildService(fakeAdmin({ passwordHash }));

    await service.changePassword("admin-1", "old-password-123", "new-password-456");

    expect(state!.passwordHash).not.toBe(passwordHash);
  });

  it("rejette un mot de passe actuel incorrect sans modifier le hash", async () => {
    const passwordHash = await hashPassword("old-password-123");
    const { service, state } = buildService(fakeAdmin({ passwordHash }));

    await expect(service.changePassword("admin-1", "wrong-password", "new-password-456")).rejects.toThrow("Mot de passe actuel incorrect");
    expect(state!.passwordHash).toBe(passwordHash);
  });
});

describe("AdminAuthService 2FA setup/enable/disable", () => {
  it("setupTwoFactor génère un secret sans activer le 2FA", async () => {
    const { service, state } = buildService(fakeAdmin());

    const { secret, otpauthUrl, qrCodeDataUrl } = await service.setupTwoFactor("admin-1");

    expect(secret.length).toBeGreaterThan(0);
    expect(otpauthUrl).toContain("otpauth://totp/");
    expect(qrCodeDataUrl).toContain("data:image/png;base64,");
    expect(state!.totpSecret).toBe(secret);
    expect(state!.totpEnabled).toBe(false);
  });

  it("enableTwoFactor active le 2FA avec un code valide généré à partir du secret de setup", async () => {
    const { service, state } = buildService(fakeAdmin());

    const { secret } = await service.setupTwoFactor("admin-1");
    const code = await generateTotpCode(secret);
    await service.enableTwoFactor("admin-1", code);

    expect(state!.totpEnabled).toBe(true);
  });

  it("enableTwoFactor rejette un code invalide sans activer le 2FA", async () => {
    const { service, state } = buildService(fakeAdmin());

    await service.setupTwoFactor("admin-1");
    await expect(service.enableTwoFactor("admin-1", "000000")).rejects.toThrow("Code de vérification invalide");
    expect(state!.totpEnabled).toBe(false);
  });

  it("enableTwoFactor rejette quand aucun setup n'a été amorcé", async () => {
    const { service } = buildService(fakeAdmin());
    await expect(service.enableTwoFactor("admin-1", "123456")).rejects.toThrow("Aucune configuration 2FA en attente");
  });

  it("disableTwoFactor efface le secret quand le mot de passe est correct", async () => {
    const passwordHash = await hashPassword("correct-password-123");
    const secret = generateTotpSecret();
    const { service, state } = buildService(fakeAdmin({ passwordHash, totpSecret: secret, totpEnabled: true }));

    await service.disableTwoFactor("admin-1", "correct-password-123");

    expect(state!.totpEnabled).toBe(false);
    expect(state!.totpSecret).toBeNull();
  });

  it("disableTwoFactor rejette un mot de passe incorrect sans désactiver le 2FA", async () => {
    const passwordHash = await hashPassword("correct-password-123");
    const secret = generateTotpSecret();
    const { service, state } = buildService(fakeAdmin({ passwordHash, totpSecret: secret, totpEnabled: true }));

    await expect(service.disableTwoFactor("admin-1", "wrong-password")).rejects.toThrow("Mot de passe incorrect");
    expect(state!.totpEnabled).toBe(true);
  });
});
