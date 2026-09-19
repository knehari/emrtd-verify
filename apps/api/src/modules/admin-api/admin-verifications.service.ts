import { Injectable, NotFoundException } from "@nestjs/common";
import type { VerificationResult } from "@emrtd-verify/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import type { ListVerificationsQueryDto } from "./dto/list-verifications-query.dto";

/**
 * Revue globale des vérifications, tous tenants confondus — vue opérateur (voir
 * docs/admin-web.md "Revue des vérifications"), distincte de la revue tenant (Phase 1e, scopée
 * à un seul kycClientId). Un administrateur voit le VerificationResult complet, sans le filtrage
 * `allowedFields` appliqué côté client KYC : c'est un rôle opérationnel de confiance, pas un
 * tiers externe (voir docs/threat-model.md).
 */
@Injectable()
export class AdminVerificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListVerificationsQueryDto) {
    const where = {
      ...(query.verdict ? { verdict: query.verdict } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.issuingCountry ? { issuingCountry: query.issuingCountry } : {}),
    };

    const [total, records] = await this.prisma.$transaction([
      this.prisma.verificationRecord.count({ where }),
      this.prisma.verificationRecord.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          verificationId: true,
          clientId: true,
          documentType: true,
          issuingCountry: true,
          verdict: true,
          trustChainSource: true,
          trustChainLevel: true,
          createdAt: true,
        },
      }),
    ]);

    return { page: query.page, pageSize: query.pageSize, total, records };
  }

  async get(verificationId: string): Promise<VerificationResult & { clientId: string }> {
    const record = await this.prisma.verificationRecord.findUnique({ where: { verificationId } });
    if (!record) {
      throw new NotFoundException(`Aucune vérification trouvée pour l'identifiant ${verificationId}`);
    }
    return { ...(record.result as unknown as VerificationResult), clientId: record.clientId };
  }
}
