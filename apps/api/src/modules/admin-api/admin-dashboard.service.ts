import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** Agrégats pour le tableau de bord de apps/admin-web — voir docs/admin-web.md. */
@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async stats() {
    const [totalTenants, activeTenants, totalAdmins, verdictGroups, last24hCount] = await Promise.all([
      this.prisma.kycClient.count(),
      this.prisma.kycClient.count({ where: { active: true } }),
      this.prisma.adminUser.count(),
      this.prisma.verificationRecord.groupBy({ by: ["verdict"], _count: { _all: true } }),
      this.prisma.verificationRecord.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
    ]);

    const verdictCounts = { authentic: 0, suspicious: 0, rejected: 0, manual_review_required: 0 };
    for (const row of verdictGroups) {
      verdictCounts[row.verdict as keyof typeof verdictCounts] = row._count._all;
    }

    return {
      totalTenants,
      activeTenants,
      totalAdmins,
      verificationsLast24h: last24hCount,
      verificationsByVerdict: verdictCounts,
      verificationsTotal: Object.values(verdictCounts).reduce((sum, n) => sum + n, 0),
    };
  }
}
