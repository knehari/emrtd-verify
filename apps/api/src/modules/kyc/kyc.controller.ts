import { Controller } from "@nestjs/common";
import { KycService } from "./kyc.service";

/**
 * Endpoints spécifiques à l'intégration KYC (gestion des clients, politiques de risque
 * par client). Le contrat de restitution du résultat est déjà exposé par
 * VerificationController — voir docs/kyc-integration.md.
 */
@Controller("v1/kyc")
export class KycController {
  constructor(private readonly kycService: KycService) {}
}
