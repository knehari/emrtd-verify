import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { signJsonPayload, importEcdsaP256PrivateKeyFromPkcs8Base64 } from "@emrtd-verify/emrtd-core";
import type { CscaBundle } from "@emrtd-verify/shared-types";

/**
 * Signe cryptographiquement le bundle CSCA hors ligne (`CscaBundle.signature`) — permet au mobile
 * de détecter une altération du bundle entre son émission par le backend et son utilisation
 * locale (voir docs/pki-trust-model.md "Vérification hors ligne"). ECDSA P-256 sur la
 * sérialisation JSON canonique du bundle (hors champ `signature` lui-même), même mécanisme que
 * `ResultSignerService` — voir packages/emrtd-core/src/crypto/jsonSigning.ts.
 *
 * Clé dédiée, distincte de `VERIFICATION_RESULT_SIGNING_*` : une compromission de la clé de
 * signature des résultats de vérification ne doit pas permettre de forger un bundle CSCA (et
 * inversement), principe de moindre privilège entre deux surfaces de confiance différentes.
 *
 * Même limite de custodie qu'ResultSignerService (honnête, pas un oubli) : clé privée chargée
 * depuis une variable d'environnement, suffisant pour développer/tester, pas pour la production
 * (HSM/KMS requis, voir docs/roadmap.md Phase 5).
 */
@Injectable()
export class CscaBundleSignerService {
  private readonly logger = new Logger(CscaBundleSignerService.name);
  private cachedPrivateKey: Promise<CryptoKey | undefined> | undefined;

  constructor(private readonly config: ConfigService) {}

  async sign(bundleWithoutSignature: Omit<CscaBundle, "signature">): Promise<string> {
    const privateKey = await this.loadPrivateKey();
    if (!privateKey) {
      this.logger.warn(
        "CSCA_BUNDLE_SIGNING_PRIVATE_KEY non configurée — bundle CSCA émis sans signature (voir docs/roadmap.md Phase 5)",
      );
      return "";
    }
    return signJsonPayload(bundleWithoutSignature, privateKey);
  }

  /** Clé publique (SPKI base64) exposée au mobile pour vérifier la signature du bundle — voir PkiTrustController. */
  getPublicKeyBase64(): string | undefined {
    return this.config.get<string>("CSCA_BUNDLE_SIGNING_PUBLIC_KEY") || undefined;
  }

  private loadPrivateKey(): Promise<CryptoKey | undefined> {
    if (!this.cachedPrivateKey) {
      this.cachedPrivateKey = this.doLoadPrivateKey();
    }
    return this.cachedPrivateKey;
  }

  private async doLoadPrivateKey(): Promise<CryptoKey | undefined> {
    const pkcs8Base64 = this.config.get<string>("CSCA_BUNDLE_SIGNING_PRIVATE_KEY");
    if (!pkcs8Base64) {
      return undefined;
    }
    try {
      return await importEcdsaP256PrivateKeyFromPkcs8Base64(pkcs8Base64);
    } catch (error) {
      this.logger.error(`CSCA_BUNDLE_SIGNING_PRIVATE_KEY invalide (attendu : PKCS8 ECDSA P-256 en base64) : ${String(error)}`);
      return undefined;
    }
  }
}
