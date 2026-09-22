import { Controller, Get, HttpException, HttpStatus, UseGuards } from "@nestjs/common";
import { KycApiKeyGuard } from "../kyc/kyc-api-key.guard";
import { CscaBundleService } from "./csca-bundle.service";
import { CscaBundleSignerService } from "./csca-bundle-signer.service";

/**
 * Distribution du bundle CSCA hors ligne au mobile — voir docs/pki-trust-model.md "Vérification
 * hors ligne". Même garde que VerificationController (KycApiKeyGuard) : le bundle CSCA n'est pas
 * une donnée publique au sens "accessible sans authentification" — seul un client KYC provisionné
 * peut le récupérer, cohérent avec le reste de l'API (voir docs/kyc-integration.md
 * "Authentification").
 */
@Controller("v1/pki-trust")
@UseGuards(KycApiKeyGuard)
export class PkiTrustController {
  constructor(
    private readonly cscaBundle: CscaBundleService,
    private readonly bundleSigner: CscaBundleSignerService,
  ) {}

  /**
   * Bundle signé des ancres CSCA ICAO PKD du lot actif — à appeler périodiquement par le mobile
   * pour rafraîchir son magasin de confiance local (voir apps/mobile, tâche de synchronisation
   * hors ligne). 503 si aucune synchronisation Master List n'a encore réussi côté serveur (pas de
   * lot actif à distribuer) plutôt qu'un bundle vide silencieusement trompeur.
   */
  @Get("csca-bundle")
  async getCscaBundle() {
    const bundle = await this.cscaBundle.buildBundle();
    if (!bundle) {
      throw new HttpException(
        "Aucune synchronisation Master List CSCA n'a encore réussi — bundle indisponible",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return bundle;
  }

  /**
   * Clé publique (SPKI, ECDSA P-256, base64) permettant au mobile de vérifier `CscaBundle.signature`
   * avant de faire confiance à un bundle synchronisé — voir docs/pki-trust-model.md "Vérification
   * hors ligne".
   */
  @Get("csca-bundle/signing-key")
  getSigningKey() {
    return {
      algorithm: "ECDSA-P256-SHA256",
      publicKeySpkiBase64: this.bundleSigner.getPublicKeyBase64() ?? null,
    };
  }
}
