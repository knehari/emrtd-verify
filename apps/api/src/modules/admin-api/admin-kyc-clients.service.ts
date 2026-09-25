import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { KycClientService } from "../kyc/kyc-client.service";
import type { CreateKycClientDto } from "./dto/create-kyc-client.dto";
import type { UpdateKycClientDto } from "./dto/update-kyc-client.dto";

/**
 * CRUD des tenants (KycClient) réservé aux administrateurs internes — voir docs/admin-web.md
 * "CRUD clients KYC". Remplace le script `scripts/create-kyc-client.ts` par un endpoint HTTP
 * authentifié pour apps/admin-web, sans changer le principe : pas d'auto-inscription, la clé
 * API n'est jamais stockée en clair ni réaffichée après sa création/rotation.
 */
@Injectable()
export class AdminKycClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const clients = await this.prisma.kycClient.findMany({ orderBy: { createdAt: "desc" } });
    return clients.map(toSafeKycClient);
  }

  async get(clientId: string) {
    const client = await this.prisma.kycClient.findUnique({ where: { clientId } });
    if (!client) {
      throw new NotFoundException(`Aucun client KYC "${clientId}"`);
    }
    return toSafeKycClient(client);
  }

  /** Renvoie la clé API en clair — jamais réaffichée après cet appel (voir apiKeyHash). */
  async create(dto: CreateKycClientDto) {
    const existing = await this.prisma.kycClient.findUnique({ where: { clientId: dto.clientId } });
    if (existing) {
      throw new ConflictException(`Un client KYC "${dto.clientId}" existe déjà`);
    }

    const apiKey = KycClientService.generateApiKey();
    const client = await this.prisma.kycClient.create({
      data: {
        clientId: dto.clientId,
        apiKeyHash: KycClientService.hashApiKey(apiKey),
        acceptedTrustLevels: dto.acceptedTrustLevels,
        allowedFields: dto.allowedFields,
        lostStolenCheckRequired: dto.lostStolenCheckRequired ?? true,
        activeLivenessRequired: dto.activeLivenessRequired ?? true,
        active: true,
      },
    });

    return { ...toSafeKycClient(client), apiKey };
  }

  async update(clientId: string, dto: UpdateKycClientDto) {
    const existing = await this.prisma.kycClient.findUnique({ where: { clientId } });
    if (!existing) {
      throw new NotFoundException(`Aucun client KYC "${clientId}"`);
    }

    const updated = await this.prisma.kycClient.update({
      where: { clientId },
      data: {
        acceptedTrustLevels: dto.acceptedTrustLevels,
        allowedFields: dto.allowedFields,
        lostStolenCheckRequired: dto.lostStolenCheckRequired,
        activeLivenessRequired: dto.activeLivenessRequired,
        active: dto.active,
      },
    });
    return toSafeKycClient(updated);
  }

  /** Renvoie la nouvelle clé API en clair — l'ancienne cesse immédiatement de fonctionner. */
  async rotateApiKey(clientId: string) {
    const existing = await this.prisma.kycClient.findUnique({ where: { clientId } });
    if (!existing) {
      throw new NotFoundException(`Aucun client KYC "${clientId}"`);
    }

    const apiKey = KycClientService.generateApiKey();
    const updated = await this.prisma.kycClient.update({
      where: { clientId },
      data: { apiKeyHash: KycClientService.hashApiKey(apiKey) },
    });
    return { ...toSafeKycClient(updated), apiKey };
  }
}

/** Ne renvoie jamais `apiKeyHash` dans une réponse HTTP — surface d'attaque inutile. */
function toSafeKycClient(client: {
  id: string;
  clientId: string;
  acceptedTrustLevels: string[];
  allowedFields: string[];
  lostStolenCheckRequired: boolean;
  activeLivenessRequired: boolean;
  active: boolean;
  createdAt: Date;
}) {
  return {
    id: client.id,
    clientId: client.clientId,
    acceptedTrustLevels: client.acceptedTrustLevels,
    allowedFields: client.allowedFields,
    lostStolenCheckRequired: client.lostStolenCheckRequired,
    activeLivenessRequired: client.activeLivenessRequired,
    active: client.active,
    createdAt: client.createdAt,
  };
}
