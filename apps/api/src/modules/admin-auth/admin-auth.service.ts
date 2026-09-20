import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { hashPassword, verifyPassword } from "../../common/security/password-hasher";
import { buildTotpOtpauthUrl, generateTotpQrCodeDataUrl, generateTotpSecret, verifyTotpCode } from "../../common/security/totp";

export interface AdminSessionPayload {
  sub: string;
  email: string;
  role: "SUPER_ADMIN" | "SUPPORT";
  typ: "admin";
}

/** Jeton court (5 min), distinct d'AdminSessionPayload par `typ` — jamais accepté par verifyToken. */
interface AdminTwoFactorChallengePayload {
  sub: string;
  typ: "admin_2fa_challenge";
}

const TWO_FACTOR_CHALLENGE_TTL = "5m";

type AdminSummary = { id: string; email: string; role: "SUPER_ADMIN" | "SUPPORT" };

export type AdminLoginResult = { requiresTwoFactor: true; challengeToken: string } | { requiresTwoFactor: false; token: string; admin: AdminSummary };

/**
 * Authentification des administrateurs internes SaaS (apps/admin-web) — voir docs/admin-web.md.
 * Comptes provisionnés hors API (scripts/create-admin-user.ts), jamais par auto-inscription,
 * même principe que KycClientService (voir docs/kyc-integration.md).
 */
@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string): Promise<AdminLoginResult> {
    const admin = await this.prisma.adminUser.findUnique({ where: { email } });
    // Message d'erreur identique que l'email existe ou non, et vérification systématique
    // (avec un hash factice si l'admin n'existe pas) pour ne pas révéler l'existence d'un
    // compte par une différence de timing — voir docs/threat-model.md.
    const passwordHash = admin?.passwordHash ?? "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000:00";
    const passwordValid = await verifyPassword(password, passwordHash);

    if (!admin || !admin.active || !passwordValid) {
      throw new UnauthorizedException("Identifiants invalides");
    }

    if (admin.totpEnabled) {
      const challengePayload: AdminTwoFactorChallengePayload = { sub: admin.id, typ: "admin_2fa_challenge" };
      const challengeToken = await this.jwt.signAsync(challengePayload, { expiresIn: TWO_FACTOR_CHALLENGE_TTL });
      return { requiresTwoFactor: true, challengeToken };
    }

    return this.finalizeLogin(admin);
  }

  /** Seconde étape du login quand `totpEnabled` — voir AdminAuthController "2fa/verify". */
  async verifyTwoFactorChallenge(challengeToken: string, code: string): Promise<Extract<AdminLoginResult, { requiresTwoFactor: false }>> {
    let payload: AdminTwoFactorChallengePayload;
    try {
      payload = await this.jwt.verifyAsync<AdminTwoFactorChallengePayload>(challengeToken);
    } catch {
      throw new UnauthorizedException("Jeton de vérification invalide ou expiré");
    }
    if (payload.typ !== "admin_2fa_challenge") {
      throw new UnauthorizedException("Jeton de vérification invalide");
    }

    const admin = await this.prisma.adminUser.findUnique({ where: { id: payload.sub } });
    if (!admin || !admin.active || !admin.totpEnabled || !admin.totpSecret) {
      throw new UnauthorizedException("Jeton de vérification invalide");
    }

    const codeValid = await verifyTotpCode(code, admin.totpSecret);
    if (!codeValid) {
      throw new UnauthorizedException("Code de vérification invalide");
    }

    return this.finalizeLogin(admin);
  }

  private async finalizeLogin(admin: AdminSummary & { id: string }): Promise<Extract<AdminLoginResult, { requiresTwoFactor: false }>> {
    await this.prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    const payload: AdminSessionPayload = { sub: admin.id, email: admin.email, role: admin.role, typ: "admin" };
    const token = await this.jwt.signAsync(payload);
    return { requiresTwoFactor: false, token, admin: { id: admin.id, email: admin.email, role: admin.role } };
  }

  /**
   * Le JWT (12h) prouve seulement qu'un login a eu lieu, pas que le compte est toujours actif au
   * rôle qu'il annonce — un administrateur désactivé ou rétrogradé entre-temps resterait sinon
   * privilégié jusqu'à expiration du cookie. Revalide donc systématiquement `active`/`role` en
   * base à chaque requête plutôt que de faire confiance au seul contenu signé du jeton.
   */
  async verifyToken(token: string): Promise<AdminSessionPayload> {
    const payload = await this.jwt.verifyAsync<AdminSessionPayload>(token);
    if (payload.typ !== "admin") {
      throw new UnauthorizedException("Jeton de session invalide");
    }
    const admin = await this.prisma.adminUser.findUnique({ where: { id: payload.sub } });
    if (!admin || !admin.active) {
      throw new UnauthorizedException("Compte administrateur désactivé");
    }
    return { sub: admin.id, email: admin.email, role: admin.role, typ: "admin" };
  }

  /**
   * Profil courant lu en base (pas seulement le contenu du JWT, potentiellement âgé de 12h) —
   * utilisé par GET /admin/auth/me pour que `totpEnabled` reflète toujours l'état réel, y
   * compris juste après un enable/disable 2FA dans la même session.
   */
  async getProfile(adminId: string): Promise<(AdminSummary & { totpEnabled: boolean }) | null> {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin) {
      return null;
    }
    return { id: admin.id, email: admin.email, role: admin.role, totpEnabled: admin.totpEnabled };
  }

  /** Changement de mot de passe en libre-service — exige le mot de passe actuel, jamais la seule session. */
  async changePassword(adminId: string, currentPassword: string, newPassword: string): Promise<void> {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin) {
      throw new UnauthorizedException("Session invalide");
    }
    const currentValid = await verifyPassword(currentPassword, admin.passwordHash);
    if (!currentValid) {
      throw new UnauthorizedException("Mot de passe actuel incorrect");
    }
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.adminUser.update({ where: { id: adminId }, data: { passwordHash } });
  }

  /**
   * Amorce la configuration 2FA : génère et persiste un nouveau secret TOTP, mais `totpEnabled`
   * reste false tant que `enableTwoFactor` n'a pas confirmé un code valide — un appel non abouti
   * laisse un secret orphelin inoffensif (voir schema.prisma AdminUser.totpSecret).
   */
  async setupTwoFactor(adminId: string): Promise<{ secret: string; otpauthUrl: string; qrCodeDataUrl: string }> {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin) {
      throw new UnauthorizedException("Session invalide");
    }
    const secret = generateTotpSecret();
    await this.prisma.adminUser.update({ where: { id: adminId }, data: { totpSecret: secret, totpEnabled: false } });
    const otpauthUrl = buildTotpOtpauthUrl(admin.email, secret);
    const qrCodeDataUrl = await generateTotpQrCodeDataUrl(otpauthUrl);
    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  async enableTwoFactor(adminId: string, code: string): Promise<void> {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin || !admin.totpSecret) {
      throw new BadRequestException("Aucune configuration 2FA en attente — appeler /admin/auth/2fa/setup d'abord");
    }
    const valid = await verifyTotpCode(code, admin.totpSecret);
    if (!valid) {
      throw new UnauthorizedException("Code de vérification invalide");
    }
    await this.prisma.adminUser.update({ where: { id: adminId }, data: { totpEnabled: true } });
  }

  /** Exige le mot de passe (pas seulement la session) avant de désactiver le 2FA — action sensible. */
  async disableTwoFactor(adminId: string, password: string): Promise<void> {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin) {
      throw new UnauthorizedException("Session invalide");
    }
    const passwordValid = await verifyPassword(password, admin.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException("Mot de passe incorrect");
    }
    await this.prisma.adminUser.update({ where: { id: adminId }, data: { totpEnabled: false, totpSecret: null } });
  }
}
