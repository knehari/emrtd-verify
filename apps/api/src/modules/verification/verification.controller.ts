import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { KycApiKeyGuard } from "../kyc/kyc-api-key.guard";
import { VerificationService } from "./verification.service";
import { ResultSignerService } from "./result-signer.service";
import { LivenessChallengeService } from "./liveness-challenge.service";
import { SubmitVerificationDto } from "./dto/submit-verification.dto";

/**
 * Toute cette API nécessite une authentification par clé API (voir KycApiKeyGuard et
 * docs/kyc-integration.md "Authentification") — aucun client par défaut, aucune politique de
 * risque implicite.
 */
@Controller("v1/verifications")
@UseGuards(KycApiKeyGuard)
export class VerificationController {
  constructor(
    private readonly verificationService: VerificationService,
    private readonly resultSigner: ResultSignerService,
    private readonly livenessChallenge: LivenessChallengeService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  submit(@Body() dto: SubmitVerificationDto, @Req() request: FastifyRequest) {
    // KycApiKeyGuard a déjà authentifié la requête et rempli request.kycClient.
    return this.verificationService.submit(dto, request.kycClient!);
  }

  /**
   * Émet un challenge de liveness active signé (voir LivenessChallengeService et
   * packages/emrtd-core/src/liveness/challenge.ts) — à appeler par le mobile juste avant de
   * démarrer la capture (`FaceLivenessSession.start`), puis à renvoyer tel quel (avec la réponse
   * capturée) dans `SubmitVerificationDto.activeLiveness`. Route statique déclarée AVANT
   * `:verificationId` pour ne pas être interprétée comme un identifiant de vérification.
   */
  @Post("liveness-challenge")
  @HttpCode(HttpStatus.OK)
  issueLivenessChallenge() {
    return this.livenessChallenge.issue();
  }

  /**
   * Clé publique (SPKI, ECDSA P-256, base64) permettant au client KYC de vérifier
   * `VerificationResult.signature` lui-même — voir docs/kyc-integration.md "Vérification de la
   * signature". Route statique déclarée AVANT `:verificationId` pour ne pas être interprétée
   * comme un identifiant de vérification par le routeur.
   */
  @Get("signing-key")
  getSigningKey() {
    const publicKeyBase64 = this.resultSigner.getPublicKeyBase64();
    return {
      algorithm: "ECDSA-P256-SHA256",
      publicKeySpkiBase64: publicKeyBase64 ?? null,
    };
  }

  @Get(":verificationId")
  getResult(@Param("verificationId") verificationId: string, @Req() request: FastifyRequest) {
    return this.verificationService.getResult(verificationId, request.kycClient!.clientId);
  }
}
