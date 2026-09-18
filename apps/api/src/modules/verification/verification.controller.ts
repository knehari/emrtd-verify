import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { KycApiKeyGuard } from "../kyc/kyc-api-key.guard";
import { VerificationService } from "./verification.service";
import { SubmitVerificationDto } from "./dto/submit-verification.dto";

/**
 * Toute cette API nécessite une authentification par clé API (voir KycApiKeyGuard et
 * docs/kyc-integration.md "Authentification") — aucun client par défaut, aucune politique de
 * risque implicite.
 */
@Controller("v1/verifications")
@UseGuards(KycApiKeyGuard)
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  submit(@Body() dto: SubmitVerificationDto, @Req() request: FastifyRequest) {
    // KycApiKeyGuard a déjà authentifié la requête et rempli request.kycClient.
    return this.verificationService.submit(dto, request.kycClient!);
  }

  @Get(":verificationId")
  getResult(@Param("verificationId") verificationId: string, @Req() request: FastifyRequest) {
    return this.verificationService.getResult(verificationId, request.kycClient!.clientId);
  }
}
