import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { readFileSync } from "node:fs";
import {
  loadExtendedTrustStoreFromJson,
  NationalPkdRegistry,
  validateTrustChain,
  type ChainValidationInput,
  type ChainValidationResult,
  type CscaTrustAnchor,
  type ExtendedTrustStore,
} from "@emrtd-verify/pki-trust";
import { TrustCacheService } from "./trust-cache.service";
import { CscaStoreService } from "./csca-store.service";

export type ValidateTrustChainRequest = Omit<
  ChainValidationInput,
  "icaoPkdAnchors" | "nationalPkdRegistry" | "extendedTrustStore"
>;

/**
 * Façade au-dessus de packages/pki-trust : alimente `validateTrustChain` avec des ancres CSCA
 * mises en cache (voir TrustCacheService) plutôt que de retélécharger la Master List ICAO PKD
 * à chaque appel. Les ancres elles-mêmes proviennent du magasin persisté et synchronisé
 * périodiquement (voir CscaSyncService/CscaStoreService) — ce chemin de lecture ne fait jamais
 * de réseau ni de vérification cryptographique, uniquement une lecture DB + cache TTL, pour
 * rester rapide sur le chemin d'une vérification (voir docs/pki-trust-model.md "Rapidité").
 */
@Injectable()
export class PkiTrustService {
  private readonly logger = new Logger(PkiTrustService.name);
  private readonly nationalPkdRegistry = new NationalPkdRegistry();
  private readonly extendedTrustStore: ExtendedTrustStore;

  constructor(
    private readonly config: ConfigService,
    private readonly trustCache: TrustCacheService,
    private readonly cscaStore: CscaStoreService,
  ) {
    this.extendedTrustStore = this.loadExtendedTrustStore();
  }

  private loadExtendedTrustStore(): ExtendedTrustStore {
    const path = this.config.get<string>("EXTENDED_TRUST_STORE_PATH");
    if (!path) {
      return loadExtendedTrustStoreFromJson([]);
    }
    try {
      const raw = readFileSync(path, "utf-8");
      return loadExtendedTrustStoreFromJson(JSON.parse(raw));
    } catch (error) {
      // Absence de fichier (ex. environnement de dev/CI sans magasin étendu configuré) ne doit
      // jamais empêcher le démarrage de l'API — voir docs/pki-trust-model.md.
      this.logger.warn(
        `Magasin de confiance étendu introuvable ou invalide (${path}), démarrage avec un magasin vide : ${String(error)}`,
      );
      return loadExtendedTrustStoreFromJson([]);
    }
  }

  /** Ancres CSCA ICAO PKD pour un pays, via le cache TTL (voir TrustCacheService) devant le magasin synchronisé (CscaStoreService). */
  async getIcaoAnchors(countryCode: string): Promise<CscaTrustAnchor[]> {
    const cached = this.trustCache.get(countryCode);
    if (cached) {
      return cached;
    }

    const anchors = await this.cscaStore.getAnchorsForCountry(countryCode);
    this.trustCache.set(countryCode, anchors);
    return anchors;
  }

  async validate(request: ValidateTrustChainRequest): Promise<ChainValidationResult> {
    const icaoPkdAnchors = await this.getIcaoAnchors(request.countryCode);
    return validateTrustChain({
      ...request,
      icaoPkdAnchors,
      nationalPkdRegistry: this.nationalPkdRegistry,
      extendedTrustStore: this.extendedTrustStore,
    });
  }
}
