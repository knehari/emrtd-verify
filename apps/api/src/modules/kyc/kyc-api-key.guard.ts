import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { KycClientService, type AuthenticatedKycClient } from "./kyc-client.service";

declare module "fastify" {
  interface FastifyRequest {
    kycClient?: AuthenticatedKycClient;
  }
}

/**
 * Authentifie chaque requête entrante via `Authorization: Bearer <clé API>` et attache le
 * client résolu à la requête (`request.kycClient`) pour que les contrôleurs en aval
 * connaissent l'identité et la politique de risque du client appelant — voir
 * docs/kyc-integration.md "Authentification". Refuse plutôt que de dégrader silencieusement
 * (pas de client par défaut ni de politique de risque implicite).
 */
@Injectable()
export class KycApiKeyGuard implements CanActivate {
  constructor(private readonly kycClientService: KycClientService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const header = request.headers.authorization;
    const rawApiKey = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;

    if (!rawApiKey) {
      throw new UnauthorizedException("Authentification requise : en-tête Authorization: Bearer <clé API>");
    }

    const client = await this.kycClientService.authenticate(rawApiKey);
    if (!client) {
      throw new UnauthorizedException("Clé API invalide, inconnue ou désactivée");
    }

    request.kycClient = client;
    return true;
  }
}
