import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import type { VerificationResult } from "@emrtd-verify/shared-types";
import { PrismaService } from "../prisma/prisma.service";
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

  async submit(dto: SubmitVerificationDto): Promise<{ verificationId: string }> {
    const verificationId = randomUUID();

    // TODO(docs/kyc-integration.md "Authentification") : le clientId devrait provenir de
    // l'authentification OAuth2/mTLS du client KYC appelant ; aucune couche d'auth n'existe
    // encore sur ce contrôleur, donc pas de politique de risque par client à ce stade.
    const clientId = "unknown";

    await this.verificationQueue.add("verify", { verificationId, dto, clientId });

    return { verificationId };
  }

  async getResult(verificationId: string): Promise<VerificationResult> {
    const record = await this.prisma.verificationRecord.findUnique({ where: { verificationId } });
    if (!record) {
      throw new NotFoundException(`Aucune vérification trouvée pour l'identifiant ${verificationId}`);
    }
    return record.result as unknown as VerificationResult;
  }
}
