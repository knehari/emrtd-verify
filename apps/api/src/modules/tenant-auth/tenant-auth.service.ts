import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { verifyPassword } from "../../common/security/password-hasher";

export interface TenantSessionPayload {
  sub: string;
  email: string;
  kycClientId: string;
  role: "OWNER" | "MEMBER";
  typ: "tenant";
}

export interface TenantLoginResult {
  token: string;
  tenantUser: { id: string; email: string; kycClientId: string; role: "OWNER" | "MEMBER" };
}

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
      token,
      tenantUser: { id: tenantUser.id, email: tenantUser.email, kycClientId: tenantUser.kycClientId, role: tenantUser.role },
    };
  }

  async verifyToken(token: string): Promise<TenantSessionPayload> {
    const payload = await this.jwt.verifyAsync<TenantSessionPayload>(token);
    if (payload.typ !== "tenant") {
      throw new UnauthorizedException("Jeton de session invalide");
    }
    return payload;
  }
}
