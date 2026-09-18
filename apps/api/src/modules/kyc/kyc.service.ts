import { Injectable } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import type { VerificationResult } from "@emrtd-verify/shared-types";

/**
 * Restitution du résultat à l'application tierce (voir docs/kyc-integration.md).
 * Le webhook est signé (HMAC) pour que le client KYC puisse authentifier la notification.
 */
@Injectable()
export class KycService {
  constructor(private readonly config: ConfigService) {}

  signWebhookPayload(payload: string): string {
    const secret = this.config.get<string>("KYC_WEBHOOK_SIGNING_SECRET");
    if (!secret) {
      throw new Error("KYC_WEBHOOK_SIGNING_SECRET non configuré");
    }
    return createHmac("sha256", secret).update(payload).digest("hex");
  }

  /** Filtre le résultat aux seuls champs déclarés nécessaires par le client (minimisation RGPD). */
  filterToRequestedFields(result: VerificationResult, requestedFields: string[]): VerificationResult {
    const filteredFields = Object.fromEntries(
      Object.entries(result.document.fields).filter(([key]) => requestedFields.includes(key)),
    );
    return { ...result, document: { ...result.document, fields: filteredFields } };
  }
}
