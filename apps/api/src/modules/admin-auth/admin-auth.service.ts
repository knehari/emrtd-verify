import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { verifyPassword } from "../../common/security/password-hasher";

export interface AdminSessionPayload {
  sub: string;
  email: string;
  role: "SUPER_ADMIN" | "SUPPORT";
  typ: "admin";
}

export interface AdminLoginResult {
  token: string;
  admin: { id: string; email: string; role: "SUPER_ADMIN" | "SUPPORT" };
}

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

    await this.prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });

    const payload: AdminSessionPayload = { sub: admin.id, email: admin.email, role: admin.role, typ: "admin" };
    const token = await this.jwt.signAsync(payload);
    return { token, admin: { id: admin.id, email: admin.email, role: admin.role } };
  }

  async verifyToken(token: string): Promise<AdminSessionPayload> {
    const payload = await this.jwt.verifyAsync<AdminSessionPayload>(token);
    if (payload.typ !== "admin") {
      throw new UnauthorizedException("Jeton de session invalide");
    }
    return payload;
  }
}
