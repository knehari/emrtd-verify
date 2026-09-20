import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { hashPassword, verifyPassword } from "../../common/security/password-hasher";
import { buildTotpOtpauthUrl, generateTotpQrCodeDataUrl, generateTotpSecret, verifyTotpCode } from "../../common/security/totp";

export interface TenantSessionPayload {
  sub: string;
  email: string;
  kycClientId: string;
  role: "OWNER" | "MEMBER";
  typ: "tenant";
}

/** Jeton court (5 min), distinct de TenantSessionPayload par `typ` — jamais accepté par verifyToken. */
interface TenantTwoFactorChallengePayload {
  sub: string;
  typ: "tenant_2fa_challenge";
}

const TWO_FACTOR_CHALLENGE_TTL = "5m";

type TenantUserSummary = { id: string; email: string; kycClientId: string; role: "OWNER" | "MEMBER" };

export type TenantLoginResult =
  | { requiresTwoFactor: true; challengeToken: string }
  | { requiresTwoFactor: false; token: string; tenantUser: TenantUserSummary };

/**
 * Authentification des comptes humains du portail tenant (apps/tenant-portal) — voir
 * docs/tenant-portal.md. Comptes provisionnés par un administrateur interne (voir
 * AdminUsersController), pas d'auto-inscription (la création d'un tenant reste une décision
 * commerciale/sécurité humaine, voir la réponse retenue dans docs/roadmap.md).
 */
@Injectable()
export class TenantAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string): Promise<TenantLoginResult> {
    const tenantUser = await this.prisma.tenantUser.findUnique({ where: { email } });
    // Même défense contre les attaques par timing que AdminAuthService.login.
    const passwordHash = tenantUser?.passwordHash ?? "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000:00";
    const passwordValid = await verifyPassword(password, passwordHash);

    if (!tenantUser || !tenantUser.active || !passwordValid) {
      throw new UnauthorizedException("Identifiants invalides");
    }

    if (tenantUser.totpEnabled) {
      const challengePayload: TenantTwoFactorChallengePayload = { sub: tenantUser.id, typ: "tenant_2fa_challenge" };
      const challengeToken = await this.jwt.signAsync(challengePayload, { expiresIn: TWO_FACTOR_CHALLENGE_TTL });
      return { requiresTwoFactor: true, challengeToken };
    }

    return this.finalizeLogin(tenantUser);
  }

  /** Seconde étape du login quand `totpEnabled` — voir TenantAuthController "2fa/verify". */
  async verifyTwoFactorChallenge(challengeToken: string, code: string): Promise<Extract<TenantLoginResult, { requiresTwoFactor: false }>> {
    let payload: TenantTwoFactorChallengePayload;
    try {
      payload = await this.jwt.verifyAsync<TenantTwoFactorChallengePayload>(challengeToken);
    } catch {
      throw new UnauthorizedException("Jeton de vérification invalide ou expiré");
    }
    if (payload.typ !== "tenant_2fa_challenge") {
      throw new UnauthorizedException("Jeton de vérification invalide");
    }

    const tenantUser = await this.prisma.tenantUser.findUnique({ where: { id: payload.sub } });
    if (!tenantUser || !tenantUser.active || !tenantUser.totpEnabled || !tenantUser.totpSecret) {
      throw new UnauthorizedException("Jeton de vérification invalide");
    }

    const codeValid = await verifyTotpCode(code, tenantUser.totpSecret);
    if (!codeValid) {
      throw new UnauthorizedException("Code de vérification invalide");
    }

    return this.finalizeLogin(tenantUser);
  }

  private async finalizeLogin(tenantUser: TenantUserSummary & { id: string }): Promise<Extract<TenantLoginResult, { requiresTwoFactor: false }>> {
    await this.prisma.tenantUser.update({ where: { id: tenantUser.id }, data: { lastLoginAt: new Date() } });
    const payload: TenantSessionPayload = {
      sub: tenantUser.id,
      email: tenantUser.email,
      kycClientId: tenantUser.kycClientId,
      role: tenantUser.role,
      typ: "tenant",
    };
    const token = await this.jwt.signAsync(payload);
    return {
      requiresTwoFactor: false,
      token,
      tenantUser: { id: tenantUser.id, email: tenantUser.email, kycClientId: tenantUser.kycClientId, role: tenantUser.role },
    };
  }

  /**
   * Même raisonnement qu'AdminAuthService.verifyToken : le JWT (12h) ne doit jamais être la seule
   * preuve d'un compte actif/de son rôle courant — revalidé en base à chaque requête.
   */
  async verifyToken(token: string): Promise<TenantSessionPayload> {
    const payload = await this.jwt.verifyAsync<TenantSessionPayload>(token);
    if (payload.typ !== "tenant") {
      throw new UnauthorizedException("Jeton de session invalide");
    }
    const tenantUser = await this.prisma.tenantUser.findUnique({ where: { id: payload.sub } });
    if (!tenantUser || !tenantUser.active) {
      throw new UnauthorizedException("Compte tenant désactivé");
    }
    return { sub: tenantUser.id, email: tenantUser.email, kycClientId: tenantUser.kycClientId, role: tenantUser.role, typ: "tenant" };
  }

  /** Profil courant lu en base — même principe qu'AdminAuthService.getProfile. */
  async getProfile(tenantUserId: string): Promise<(TenantUserSummary & { totpEnabled: boolean }) | null> {
    const tenantUser = await this.prisma.tenantUser.findUnique({ where: { id: tenantUserId } });
    if (!tenantUser) {
      return null;
    }
    return { id: tenantUser.id, email: tenantUser.email, kycClientId: tenantUser.kycClientId, role: tenantUser.role, totpEnabled: tenantUser.totpEnabled };
  }

  /** Changement de mot de passe en libre-service — exige le mot de passe actuel, jamais la seule session. */
  async changePassword(tenantUserId: string, currentPassword: string, newPassword: string): Promise<void> {
    const tenantUser = await this.prisma.tenantUser.findUnique({ where: { id: tenantUserId } });
    if (!tenantUser) {
      throw new UnauthorizedException("Session invalide");
    }
    const currentValid = await verifyPassword(currentPassword, tenantUser.passwordHash);
    if (!currentValid) {
      throw new UnauthorizedException("Mot de passe actuel incorrect");
    }
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.tenantUser.update({ where: { id: tenantUserId }, data: { passwordHash } });
  }

  /** Amorce la configuration 2FA — même principe qu'AdminAuthService.setupTwoFactor. */
  async setupTwoFactor(tenantUserId: string): Promise<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }> {
    const tenantUser = await this.prisma.tenantUser.findUnique({ where: { id: tenantUserId } });
    if (!tenantUser) {
      throw new UnauthorizedException("Session invalide");
    }
    const secret = generateTotpSecret();
    await this.prisma.tenantUser.update({ where: { id: tenantUserId }, data: { totpSecret: secret, totpEnabled: false } });
    const otpauthUrl = buildTotpOtpauthUrl(tenantUser.email, secret);
    const qrCodeDataUrl = await generateTotpQrCodeDataUrl(otpauthUrl);
    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  async enableTwoFactor(tenantUserId: string, code: string): Promise<void> {
    const tenantUser = await this.prisma.tenantUser.findUnique({ where: { id: tenantUserId } });
    if (!tenantUser || !tenantUser.totpSecret) {
      throw new BadRequestException("Aucune configuration 2FA en attente — appeler /portal/auth/2fa/setup d'abord");
    }
    const valid = await verifyTotpCode(code, tenantUser.totpSecret);
    if (!valid) {
      throw new UnauthorizedException("Code de vérification invalide");
    }
    await this.prisma.tenantUser.update({ where: { id: tenantUserId }, data: { totpEnabled: true } });
  }

  /** Exige le mot de passe avant de désactiver le 2FA — même principe qu'AdminAuthService.disableTwoFactor. */
  async disableTwoFactor(tenantUserId: string, password: string): Promise<void> {
    const tenantUser = await this.prisma.tenantUser.findUnique({ where: { id: tenantUserId } });
    if (!tenantUser) {
      throw new UnauthorizedException("Session invalide");
    }
    const passwordValid = await verifyPassword(password, tenantUser.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException("Mot de passe incorrect");
    }
    await this.prisma.tenantUser.update({ where: { id: tenantUserId }, data: { totpEnabled: false, totpSecret: null } });
  }
}
