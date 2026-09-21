import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createHttpsLostStolenRegistry,
  notConfiguredLostStolenRegistry,
  type LostStolenCheckResult,
  type LostStolenDocumentRegistry,
} from "./lost-stolen-registry";

/**
 * Façade injectable au-dessus de LostStolenDocumentRegistry — choisit l'implémentation (HTTPS
 * configurée ou "non configuré") au démarrage à partir de LOST_STOLEN_REGISTRY_URL_TEMPLATE
 * (voir .env.example), et absorbe toute erreur inattendue de l'implémentation (checkStatus ne
 * doit jamais faire échouer une vérification entière — voir VerificationProcessor).
 */
@Injectable()
export class DocumentStatusService {
  private readonly logger = new Logger(DocumentStatusService.name);
  private readonly registry: LostStolenDocumentRegistry;

  constructor(private readonly config: ConfigService) {
    this.registry = this.buildRegistry();
  }

  private buildRegistry(): LostStolenDocumentRegistry {
    const checkUrlTemplate = this.config.get<string>("LOST_STOLEN_REGISTRY_URL_TEMPLATE");
    if (!checkUrlTemplate) {
      return notConfiguredLostStolenRegistry;
    }
    return createHttpsLostStolenRegistry({
      checkUrlTemplate,
      apiKey: this.config.get<string>("LOST_STOLEN_REGISTRY_API_KEY"),
    });
  }

  async checkStatus(input: { issuingState: string; documentNumber: string }): Promise<LostStolenCheckResult> {
    try {
      return await this.registry.checkStatus(input);
    } catch (error) {
      this.logger.warn(`Vérification du statut perdu/volé indisponible : ${String(error)}`);
      return { checked: false, reported: false };
    }
  }
}
