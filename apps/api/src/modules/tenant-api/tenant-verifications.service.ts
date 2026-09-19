import { Injectable, NotFoundException } from "@nestjs/common";
import type { VerificationResult } from "@emrtd-verify/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import type { ListTenantVerificationsQueryDto } from "./dto/list-tenant-verifications-query.dto";

/**
 * Revue des vérifications du tenant connecté — voir docs/tenant-portal.md. Contrairement à
 * AdminVerificationsService (vue opérateur, tous tenants), toujours scopée au `kycClientId`
 * du tenant appelant. Le `VerificationResult` restitué est déjà celui filtré par
 * `KycClient.allowedFields` au moment de la vérification (voir VerificationProcessor) — aucun
 * filtrage supplémentaire nécessaire ici, même principe que VerificationService.getResult.
 */
@Injectable()
export class TenantVerificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(kycClientId: string, query: ListTenantVerificationsQueryDto) {
    const where = { clientId: kycClientId, ...(query.verdict ? { verdict: query.verdict } : {}) };

    const [total, records] = await this.prisma.$transaction([
      this.prisma.verificationRecord.count({ where }),
      this.prisma.verificationRecord.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: { verificationId: true, documentType: true, issuingCountry: true, verdict: true, createdAt: true },
      }),
    ]);

    return { page: query.page, pageSize: query.pageSize, total, records };
  }

  async get(kycClientId: string, verificationId: string): Promise<VerificationResult> {
    const record = await this.prisma.verificationRecord.findUnique({ where: { verificationId } });
    if (!record || record.clientId !== kycClientId) {
      throw new NotFoundException(`Aucune vérification trouvée pour l'identifiant ${verificationId}`);
    }
    return record.result as unknown as VerificationResult;
  }
}
