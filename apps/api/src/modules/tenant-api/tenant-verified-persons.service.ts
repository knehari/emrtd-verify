import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { ListVerifiedPersonsQueryDto } from "./dto/list-verified-persons-query.dto";
import type { UpdateVerifiedPersonDto } from "./dto/update-verified-person.dto";

/**
 * Lecture/consultation des VerifiedPerson pour le portail tenant — voir
 * docs/tenant-portal.md. STRICTEMENT scopée au `kycClientId` du tenant appelant (jamais un
 * paramètre venant de la requête) : c'est la frontière d'isolation multi-tenant, voir
 * TenantAuthGuard.
 */
@Injectable()
export class TenantVerifiedPersonsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Compteurs par statut — alimente le tableau de bord du portail tenant. */
  async stats(kycClientId: string) {
    const grouped = await this.prisma.verifiedPerson.groupBy({
      by: ["status"],
      where: { kycClientId },
      _count: { _all: true },
    });

    const counts = { VERIFIED: 0, UNVERIFIED: 0, PENDING_REVIEW: 0, WATCHLIST: 0 };
    for (const row of grouped) {
      counts[row.status] = row._count._all;
    }
    return counts;
  }

  async list(kycClientId: string, query: ListVerifiedPersonsQueryDto) {
    const where = { kycClientId, ...(query.status ? { status: query.status as never } : {}) };

    const [total, persons] = await this.prisma.$transaction([
      this.prisma.verifiedPerson.count({ where }),
      this.prisma.verifiedPerson.findMany({
        where,
        orderBy: { lastVerifiedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          status: true,
          documentType: true,
          issuingCountry: true,
          displayFields: true,
          watchlistReason: true,
          firstVerifiedAt: true,
          lastVerifiedAt: true,
          verificationCount: true,
        },
      }),
    ]);

    return { page: query.page, pageSize: query.pageSize, total, persons };
  }

  async get(kycClientId: string, id: string) {
    const person = await this.prisma.verifiedPerson.findUnique({ where: { id } });
    // 404 (jamais 403) si la fiche existe mais appartient à un autre tenant — ne jamais
    // confirmer à un tenant l'existence d'une fiche d'un autre (voir docs/threat-model.md,
    // même principe que VerificationService.getResult).
    if (!person || person.kycClientId !== kycClientId) {
      throw new NotFoundException(`Aucune fiche client trouvée pour l'identifiant ${id}`);
    }
    return person;
  }

  /** Changement de statut manuel — toujours une décision humaine, voir docs/tenant-portal.md. */
  async updateStatus(kycClientId: string, id: string, dto: UpdateVerifiedPersonDto) {
    await this.get(kycClientId, id); // vérifie l'appartenance au tenant (lève 404 sinon)

    return this.prisma.verifiedPerson.update({
      where: { id },
      data: { status: dto.status, watchlistReason: dto.status === "WATCHLIST" ? dto.watchlistReason : null },
    });
  }
}
