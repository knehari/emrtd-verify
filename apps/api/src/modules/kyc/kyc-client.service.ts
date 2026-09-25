import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export type TrustLevel = "high" | "medium" | "low";

export interface AuthenticatedKycClient {
  clientId: string;
  acceptedTrustLevels: TrustLevel[];
  allowedFields: string[];
  /** Politique du client : registre perdus/volés exigé (voir KycClient.lostStolenCheckRequired). */
  lostStolenCheckRequired: boolean;
  /** Politique du client : vivacité active exigée (voir KycClient.activeLivenessRequired). */
  activeLivenessRequired: boolean;
}

const API_KEY_PREFIX = "emrtd_";

/**
 * Provisionnement et authentification des clients KYC (voir docs/kyc-integration.md
 * "Authentification"). Les clients sont provisionnés hors API (scripts/create-kyc-client.ts),
 * jamais par auto-inscription.
 */
@Injectable()
export class KycClientService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * SHA-256 plutôt qu'un KDF lent (bcrypt/argon2) : la clé API est générée aléatoirement à haute
   * entropie (32 octets, jamais choisie par un humain), donc invulnérable à une attaque par
   * dictionnaire hors ligne — le compromis vitesse/résistance qui justifie un KDF lent pour un
   * mot de passe ne s'applique pas ici. Un KDF lent ralentirait inutilement chaque requête API.
   */
  static hashApiKey(rawApiKey: string): string {
    return createHash("sha256").update(rawApiKey).digest("hex");
  }

  static generateApiKey(): string {
    return `${API_KEY_PREFIX}${randomBytes(32).toString("hex")}`;
  }

  async authenticate(rawApiKey: string): Promise<AuthenticatedKycClient | null> {
    if (!rawApiKey.startsWith(API_KEY_PREFIX)) {
      return null;
    }
    const apiKeyHash = KycClientService.hashApiKey(rawApiKey);
    const client = await this.prisma.kycClient.findUnique({ where: { apiKeyHash } });
    if (!client || !client.active) {
      return null;
    }
    return {
      clientId: client.clientId,
      acceptedTrustLevels: client.acceptedTrustLevels as TrustLevel[],
      allowedFields: client.allowedFields,
      lostStolenCheckRequired: client.lostStolenCheckRequired,
      activeLivenessRequired: client.activeLivenessRequired,
    };
  }
}
