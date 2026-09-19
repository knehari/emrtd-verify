import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { signJsonPayload, importEcdsaP256PrivateKeyFromPkcs8Base64 } from "@emrtd-verify/emrtd-core";
import type { VerificationResult } from "@emrtd-verify/shared-types";

/**
 * Signe cryptographiquement le résultat de vérification (`VerificationResult.signature`) — permet
 * au client KYC de détecter une altération du résultat entre l'émission par la plateforme et sa
 * réception/son stockage. ECDSA P-256 sur la sérialisation JSON canonique du résultat (hors champ
 * `signature` lui-même) — voir packages/emrtd-core/src/crypto/jsonSigning.ts et
 * docs/kyc-integration.md "Vérification de la signature".
 *
 * Custodie de la clé — limite honnête de cet environnement : la clé privée est chargée depuis une
 * variable d'environnement (`VERIFICATION_RESULT_SIGNING_PRIVATE_KEY`, PKCS8 base64), ce qui est
 * SUFFISANT pour démontrer le mécanisme et le tester, mais PAS pour une mise en production réelle
 * — un déploiement de production doit détenir cette clé dans un HSM/KMS (jamais en clair dans une
 * variable d'environnement/un secret Kubernetes), voir docs/roadmap.md Phase 5.
 */
@Injectable()
export class ResultSignerService {
  private readonly logger = new Logger(ResultSignerService.name);
  private cachedPrivateKey: Promise<CryptoKey | undefined> | undefined;

  constructor(private readonly config: ConfigService) {}

  async sign(resultWithoutSignature: Omit<VerificationResult, "signature">): Promise<string> {
    const privateKey = await this.loadPrivateKey();
    if (!privateKey) {
      this.logger.warn(
        "VERIFICATION_RESULT_SIGNING_PRIVATE_KEY non configurée — résultat émis sans signature (voir docs/roadmap.md Phase 5)",
      );
      return "";
    }
    return signJsonPayload(resultWithoutSignature, privateKey);
  }

  /** Clé publique (SPKI base64) exposée aux clients KYC pour vérifier la signature — voir VerificationController. */
  getPublicKeyBase64(): string | undefined {
    return this.config.get<string>("VERIFICATION_RESULT_SIGNING_PUBLIC_KEY") || undefined;
  }

  private loadPrivateKey(): Promise<CryptoKey | undefined> {
    if (!this.cachedPrivateKey) {
      this.cachedPrivateKey = this.doLoadPrivateKey();
    }
    return this.cachedPrivateKey;
  }

  private async doLoadPrivateKey(): Promise<CryptoKey | undefined> {
    const pkcs8Base64 = this.config.get<string>("VERIFICATION_RESULT_SIGNING_PRIVATE_KEY");
    if (!pkcs8Base64) {
      return undefined;
    }
    try {
      return await importEcdsaP256PrivateKeyFromPkcs8Base64(pkcs8Base64);
    } catch (error) {
      this.logger.error(`VERIFICATION_RESULT_SIGNING_PRIVATE_KEY invalide (attendu : PKCS8 ECDSA P-256 en base64) : ${String(error)}`);
      return undefined;
    }
  }
}
