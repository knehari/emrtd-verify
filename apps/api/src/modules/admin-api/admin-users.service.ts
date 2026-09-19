import { randomBytes } from "node:crypto";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { hashPassword } from "../../common/security/password-hasher";
import type { CreateAdminUserDto } from "./dto/create-admin-user.dto";
import type { UpdateAdminUserDto } from "./dto/update-admin-user.dto";

/** CRUD des comptes administrateurs internes — voir AdminAuthService pour l'authentification. */
@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const admins = await this.prisma.adminUser.findMany({ orderBy: { createdAt: "desc" } });
    return admins.map(toSafeAdminUser);
  }

  /** Renvoie le mot de passe temporaire en clair — jamais réaffiché après cet appel. */
  async create(dto: CreateAdminUserDto) {
    const existing = await this.prisma.adminUser.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException(`Un administrateur "${dto.email}" existe déjà`);
    }

    const temporaryPassword = randomBytes(18).toString("base64url");
    const admin = await this.prisma.adminUser.create({
      data: { email: dto.email, passwordHash: await hashPassword(temporaryPassword), role: dto.role, active: true },
    });

    return { ...toSafeAdminUser(admin), temporaryPassword };
  }

  async update(id: string, dto: UpdateAdminUserDto) {
    const existing = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Aucun administrateur avec l'id "${id}"`);
    }

    const updated = await this.prisma.adminUser.update({ where: { id }, data: { role: dto.role, active: dto.active } });
    return toSafeAdminUser(updated);
  }
}

/** Ne renvoie jamais `passwordHash` dans une réponse HTTP. */
function toSafeAdminUser(admin: {
  id: string;
  email: string;
  role: string;
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}) {
  return { id: admin.id, email: admin.email, role: admin.role, active: admin.active, lastLoginAt: admin.lastLoginAt, createdAt: admin.createdAt };
}
