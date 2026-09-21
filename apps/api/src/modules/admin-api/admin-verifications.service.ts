import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { VerificationResult } from "@emrtd-verify/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import type { ListVerificationsQueryDto } from "./dto/list-verifications-query.dto";
import type { ReviewVerificationDto } from "./dto/review-verification.dto";

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
          review: { select: { id: true } },
        },
      }),
    ]);

    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      records: records.map(({ review, ...record }) => ({ ...record, reviewed: review !== null })),
    };
  }

  async get(verificationId: string): Promise<
    VerificationResult & {
      clientId: string;
      review: { outcome: string; reason: string; reviewedAt: Date; reviewer: { id: string; email: string } } | null;
    }
  > {
    const record = await this.prisma.verificationRecord.findUnique({
      where: { verificationId },
      include: { review: { include: { reviewer: { select: { id: true, email: true } } } } },
    });
    if (!record) {
      throw new NotFoundException(`Aucune vérification trouvée pour l'identifiant ${verificationId}`);
    }
    return { ...(record.result as unknown as VerificationResult), clientId: record.clientId, review: record.review };
  }

  /**
   * Trace formelle de la revue humaine — voir VerificationReview (schema.prisma) et
   * docs/pvid-compliance.md. Réservée aux vérifications "manual_review_required" (c'est le
   * verdict que ce mécanisme existe pour tracer) ; un cas déjà revu ne peut pas l'être une
   * seconde fois (contrainte unique sur verificationRecordId, la revue clôt le cas).
   */
  async review(verificationId: string, reviewerId: string, dto: ReviewVerificationDto) {
    const record = await this.prisma.verificationRecord.findUnique({ where: { verificationId } });
    if (!record) {
      throw new NotFoundException(`Aucune vérification trouvée pour l'identifiant ${verificationId}`);
    }
    if (record.verdict !== "manual_review_required") {
      throw new UnprocessableEntityException(
        `Seules les vérifications au verdict "manual_review_required" peuvent faire l'objet d'une revue formelle (verdict actuel : "${record.verdict}")`,
      );
    }

    try {
      return await this.prisma.verificationReview.create({
        data: { verificationRecordId: record.id, reviewerId, outcome: dto.outcome, reason: dto.reason },
        include: { reviewer: { select: { id: true, email: true } } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Ce cas a déjà fait l'objet d'une revue formelle");
      }
      throw error;
    }
  }
}
