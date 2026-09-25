import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import type { VerificationResult } from "@emrtd-verify/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedKycClient } from "../kyc/kyc-client.service";
import type { SubmitVerificationDto } from "./dto/submit-verification.dto";
import type { VerificationJobData } from "./verification.processor";

/**
 * Orchestrateur du parcours de vérification (voir docs/architecture.md "Flux de données").
 * `submit()` répond immédiatement avec un identifiant et met la vérification en file
 * (BullMQ) : le traitement complet implique un appel à services/face-match, potentiellement
 * lent — docs/kyc-integration.md recommande explicitement un traitement asynchrone dès que
 * la reconnaissance faciale est impliquée, pour ne jamais faire attendre l'appelant HTTP
 * sur cette dépendance externe.
 */
@Injectable()
export class VerificationService {
  constructor(
    @InjectQueue("verification") private readonly verificationQueue: Queue<VerificationJobData>,
    private readonly prisma: PrismaService,
  ) {}

  async submit(dto: SubmitVerificationDto, kycClient: AuthenticatedKycClient): Promise<{ verificationId: string }> {
    const verificationId = randomUUID();

    await this.verificationQueue.add("verify", {
      verificationId,
      dto,
      clientId: kycClient.clientId,
      clientAcceptedLevels: kycClient.acceptedTrustLevels,
      allowedFields: kycClient.allowedFields,
      lostStolenCheckRequired: kycClient.lostStolenCheckRequired,
      activeLivenessRequired: kycClient.activeLivenessRequired,
    });

    return { verificationId };
  }

  /**
   * `requestingClientId` : frontière d'autorisation — un client ne peut lire que ses propres
   * résultats. Toujours 404 (jamais 403) quand ça ne correspond pas, pour ne pas confirmer à un
   * client l'existence d'une vérification appartenant à un autre (voir docs/threat-model.md).
   */
  async getResult(verificationId: string, requestingClientId: string): Promise<VerificationResult> {
    const record = await this.prisma.verificationRecord.findUnique({ where: { verificationId } });
    if (!record || record.clientId !== requestingClientId) {
      throw new NotFoundException(`Aucune vérification trouvée pour l'identifiant ${verificationId}`);
    }
    return record.result as unknown as VerificationResult;
  }
}
