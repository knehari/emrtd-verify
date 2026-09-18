import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { readFileSync } from "node:fs";
import {
  createIcaoPkdClient,
  loadExtendedTrustStoreFromJson,
  NationalPkdRegistry,
  validateTrustChain,
  type ChainValidationInput,
  type ChainValidationResult,
  type CscaTrustAnchor,
  type ExtendedTrustStore,
  type PkdClient,
} from "@emrtd-verify/pki-trust";
import { TrustCacheService } from "./trust-cache.service";

export type ValidateTrustChainRequest = Omit<
  ChainValidationInput,
  "icaoPkdAnchors" | "nationalPkdRegistry" | "extendedTrustStore"
>;

/**
 * Façade au-dessus de packages/pki-trust : alimente `validateTrustChain` avec des ancres CSCA
 * mises en cache (voir TrustCacheService) plutôt que de retélécharger la Master List ICAO PKD
 * à chaque appel. `createIcaoPkdClient` n'a pas encore d'implémentation (voir docs/roadmap.md
 * Phase 1 — décodage LDAP/CMS des Master Lists) : cette façade dégrade alors silencieusement
 * vers les seules ancres nationales/étendues plutôt que de faire échouer toute vérification.
 */
@Injectable()
export class PkiTrustService {
  private readonly logger = new Logger(PkiTrustService.name);
  private readonly pkdClient: PkdClient;
  private readonly nationalPkdRegistry = new NationalPkdRegistry();
  private readonly extendedTrustStore: ExtendedTrustStore;

  constructor(
    private readonly config: ConfigService,
    private readonly trustCache: TrustCacheService,
  ) {
    this.pkdClient = createIcaoPkdClient({
      ldapUrl: this.config.get<string>("ICAO_PKD_LDAP_URL") ?? "",
      bindDn: this.config.get<string>("ICAO_PKD_LDAP_BIND_DN"),
      bindPassword: this.config.get<string>("ICAO_PKD_LDAP_BIND_PASSWORD"),
    });
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

  /** Ancres CSCA ICAO PKD pour un pays, via le cache TTL (voir TrustCacheService). */
  async getIcaoAnchors(countryCode: string): Promise<CscaTrustAnchor[]> {
    const cached = this.trustCache.get(countryCode);
    if (cached) {
      return cached;
    }

    let anchors: CscaTrustAnchor[] = [];
    try {
      const masterList = await this.pkdClient.fetchCscaMasterList();
      anchors = masterList.filter((a) => a.countryCode === countryCode);
    } catch (error) {
      this.logger.warn(
        `Synchronisation ICAO PKD indisponible pour ${countryCode} (voir docs/roadmap.md Phase 1) : ${String(error)}`,
      );
    }

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
