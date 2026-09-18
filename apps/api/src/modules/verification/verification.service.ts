import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { VerificationResult } from "@emrtd-verify/shared-types";
import { AnomalyDetectionService } from "../anomaly-detection/anomaly-detection.service";
import { FaceMatchClient } from "../face-match/face-match.client";
import { computeVerdict } from "./verdict.policy";
import type { SubmitVerificationDto } from "./dto/submit-verification.dto";

/**
 * Orchestrateur du parcours de vérification (voir docs/architecture.md "Flux de données").
 * Le décodage LDS/SOD (packages/emrtd-core) et la validation de la chaîne de confiance
 * (packages/pki-trust) restent à implémenter en profondeur (voir docs/roadmap.md Phase 1) ;
 * cette classe fixe déjà l'orchestration et le contrat de sortie (VerificationResult).
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly anomalyDetection: AnomalyDetectionService,
    private readonly faceMatchClient: FaceMatchClient,
  ) {}

  async submit(_dto: SubmitVerificationDto): Promise<{ verificationId: string }> {
    // TODO(roadmap Phase 1) : décoder chipData (DG + SOD), lancer la validation de chaîne
    // et la comparaison faciale en tâche asynchrone, persister le résultat, notifier par webhook.
    return { verificationId: randomUUID() };
  }

  async getResult(_verificationId: string): Promise<VerificationResult> {
    throw new Error("Non implémenté : persistance du résultat de vérification. Voir docs/roadmap.md Phase 1.");
  }
}
