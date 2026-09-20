import { describe, it, expect, vi } from "vitest";
import { JwtService } from "@nestjs/jwt";
import { TenantAuthService } from "../../src/modules/tenant-auth/tenant-auth.service";
import { hashPassword } from "../../src/common/security/password-hasher";
import { generateTotpCode, generateTotpSecret } from "../../src/common/security/totp";

type FakeTenantUser = {
  id: string;
  email: string;
  passwordHash: string;
  kycClientId: string;
  role: "OWNER" | "MEMBER";
  active: boolean;
  totpSecret: string | null;
  totpEnabled: boolean;
};

/** Fake Prisma à état mutable — même principe que test/admin-auth/admin-auth.service.test.ts. */
function buildService(tenantUser: FakeTenantUser | null) {
  const state = tenantUser ? { ...tenantUser } : null;
  const findUnique = vi.fn(async () => (state ? { ...state } : null));
  const update = vi.fn(async ({ data }: { data: Partial<FakeTenantUser> }) => {
    if (state) Object.assign(state, data);
    return state ? { ...state } : null;
  });
  const prisma = { tenantUser: { findUnique, update } } as never;
  const jwt = new JwtService({ secret: "test-tenant-secret", signOptions: { expiresIn: "12h" } });
  return { service: new TenantAuthService(prisma, jwt), findUnique, update, state };
}

function fakeTenantUser(overrides: Partial<FakeTenantUser> = {}): FakeTenantUser {
  return {
    id: "tu-1",
    email: "ops@acme.example",
    passwordHash: "",
    kycClientId: "kyc-client-1",
    role: "OWNER",
    active: true,
    totpSecret: null,
    totpEnabled: false,
    ...overrides,
  };
}

describe("TenantAuthService.login", () => {
  it("émet un jeton scopé au tenant pour des identifiants corrects (sans 2FA)", async () => {
    const passwordHash = await hashPassword("correct-password-123");
    const { service } = buildService(fakeTenantUser({ passwordHash }));

    const result = await service.login("ops@acme.example", "correct-password-123");

    expect(result.requiresTwoFactor).toBe(false);
    if (result.requiresTwoFactor) throw new Error("unreachable");
    expect(result.tenantUser).toEqual({ id: "tu-1", email: "ops@acme.example", kycClientId: "kyc-client-1", role: "OWNER" });
    const payload = await service.verifyToken(result.token);
    expect(payload).toMatchObject({ sub: "tu-1", kycClientId: "kyc-client-1", role: "OWNER", typ: "tenant" });
  });

  it("rejette un compte désactivé", async () => {
    const passwordHash = await hashPassword("correct-password-123");
    const { service } = buildService(fakeTenantUser({ passwordHash, role: "MEMBER", active: false }));

    await expect(service.login("ops@acme.example", "correct-password-123")).rejects.toThrow("Identifiants invalides");
  });

  it("rejette un jeton admin présenté comme jeton tenant (typ différent)", async () => {
    const { service } = buildService(null);
    const adminLikeJwt = new JwtService({ secret: "test-tenant-secret" });
    const token = await adminLikeJwt.signAsync({ sub: "x", typ: "admin" });

    await expect(service.verifyToken(token)).rejects.toThrow("Jeton de session invalide");
  });

  it("rejette un jeton par ailleurs valide si le compte a été désactivé depuis l'émission (pas de confiance aveugle au JWT)", async () => {
    const passwordHash = await hashPassword("correct-password-123");
    const { service, state } = buildService(fakeTenantUser({ passwordHash }));

    const result = await service.login("ops@acme.example", "correct-password-123");
    if (result.requiresTwoFactor) throw new Error("unreachable");

    state!.active = false; // désactivation postérieure à l'émission du jeton, toujours dans sa fenêtre de 12h

    await expect(service.verifyToken(result.token)).rejects.toThrow("Compte tenant désactivé");
  });

  it("reflète le rôle courant en base, pas celui figé dans le JWT au moment du login", async () => {
    const passwordHash = await hashPassword("correct-password-123");
    const { service, state } = buildService(fakeTenantUser({ passwordHash, role: "OWNER" }));

    const result = await service.login("ops@acme.example", "correct-password-123");
    if (result.requiresTwoFactor) throw new Error("unreachable");

    state!.role = "MEMBER"; // rétrogradation postérieure à l'émission du jeton

    const payload = await service.verifyToken(result.token);
    expect(payload.role).toBe("MEMBER");
  });

  it("renvoie un jeton de défi 2FA (sans poser de session) quand totpEnabled est vrai", async () => {
    const passwordHash = await hashPassword("correct-password-123");
    const secret = generateTotpSecret();
    const { service } = buildService(fakeTenantUser({ passwordHash, totpSecret: secret, totpEnabled: true }));

    const result = await service.login("ops@acme.example", "correct-password-123");

    expect(result.requiresTwoFactor).toBe(true);
    if (!result.requiresTwoFactor) throw new Error("unreachable");
    expect(result.challengeToken.length).toBeGreaterThan(0);
  });
});

describe("TenantAuthService.verifyTwoFactorChallenge", () => {
  it("finalise la session avec un code TOTP valide, scopée au bon tenant", async () => {
    const passwordHash = await hashPassword("correct-password-123");
    const secret = generateTotpSecret();
    const { service } = buildService(fakeTenantUser({ passwordHash, totpSecret: secret, totpEnabled: true }));

    const loginResult = await service.login("ops@acme.example", "correct-password-123");
    if (!loginResult.requiresTwoFactor) throw new Error("unreachable");

    const code = await generateTotpCode(secret);
    const result = await service.verifyTwoFactorChallenge(loginResult.challengeToken, code);

    expect(result.tenantUser).toEqual({ id: "tu-1", email: "ops@acme.example", kycClientId: "kyc-client-1", role: "OWNER" });
  });

  it("rejette un code TOTP invalide", async () => {
    const passwordHash = await hashPassword("correct-password-123");
    const secret = generateTotpSecret();
    const { service } = buildService(fakeTenantUser({ passwordHash, totpSecret: secret, totpEnabled: true }));

    const loginResult = await service.login("ops@acme.example", "correct-password-123");
    if (!loginResult.requiresTwoFactor) throw new Error("unreachable");

    await expect(service.verifyTwoFactorChallenge(loginResult.challengeToken, "000000")).rejects.toThrow("Code de vérification invalide");
  });
});

describe("TenantAuthService.changePassword", () => {
  it("met à jour le hash quand le mot de passe actuel est correct", async () => {
    const passwordHash = await hashPassword("old-password-123");
    const { service, state } = buildService(fakeTenantUser({ passwordHash }));

    await service.changePassword("tu-1", "old-password-123", "new-password-456");

    expect(state!.passwordHash).not.toBe(passwordHash);
  });

  it("rejette un mot de passe actuel incorrect sans modifier le hash", async () => {
    const passwordHash = await hashPassword("old-password-123");
    const { service, state } = buildService(fakeTenantUser({ passwordHash }));

    await expect(service.changePassword("tu-1", "wrong-password", "new-password-456")).rejects.toThrow("Mot de passe actuel incorrect");
    expect(state!.passwordHash).toBe(passwordHash);
  });
});

describe("TenantAuthService 2FA setup/enable/disable", () => {
  it("setupTwoFactor génère un secret sans activer le 2FA", async () => {
    const { service, state } = buildService(fakeTenantUser());

    const { secret, otpauthUrl, qrCodeDataUrl } = await service.setupTwoFactor("tu-1");

    expect(secret.length).toBeGreaterThan(0);
    expect(otpauthUrl).toContain("otpauth://totp/");
    expect(qrCodeDataUrl).toContain("data:image/png;base64,");
    expect(state!.totpSecret).toBe(secret);
    expect(state!.totpEnabled).toBe(false);
  });

  it("enableTwoFactor active le 2FA avec un code valide généré à partir du secret de setup", async () => {
    const { service, state } = buildService(fakeTenantUser());

    const { secret } = await service.setupTwoFactor("tu-1");
    const code = await generateTotpCode(secret);
    await service.enableTwoFactor("tu-1", code);

    expect(state!.totpEnabled).toBe(true);
  });

  it("disableTwoFactor efface le secret quand le mot de passe est correct", async () => {
    const passwordHash = await hashPassword("correct-password-123");
    const secret = generateTotpSecret();
    const { service, state } = buildService(fakeTenantUser({ passwordHash, totpSecret: secret, totpEnabled: true }));

    await service.disableTwoFactor("tu-1", "correct-password-123");

    expect(state!.totpEnabled).toBe(false);
    expect(state!.totpSecret).toBeNull();
  });
});
