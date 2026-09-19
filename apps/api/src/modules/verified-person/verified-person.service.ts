import { createHash } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type { Prisma, VerifiedPersonStatus } from "@prisma/client";
import type { Verdict } from "@emrtd-verify/shared-types";
import { PrismaService } from "../prisma/prisma.service";

export interface LinkVerificationParams {
  /** `KycClient.clientId` public — jamais l'id interne, voir schema.prisma. */
  kycClientId: string;
  verificationRecordId: string;
  documentType: string;
  issuingCountry: string;
  documentNumber: string;
  dateOfBirth: string;
  verdict: Verdict;
  /** Déjà filtré par `KycClient.allowedFields` (voir buildRequestedFieldChecks) — jamais plus. */
  displayFields: Record<string, unknown>;
}

/**
 * Consolide plusieurs tentatives de vérification pour "la même" personne au sein d'un tenant
 * (voir schema.prisma "VerifiedPerson" et docs/gdpr-compliance.md). Rapprochement par clé
 * naturelle hachée, jamais stockée en clair — limite assumée : un renouvellement de document
 * (nouveau documentNumber) crée une nouvelle fiche plutôt que de rattacher à l'ancienne (voir
 * docs/roadmap.md).
 */
@Injectable()
export class VerifiedPersonService {
  private readonly logger = new Logger(VerifiedPersonService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * SHA-256 plutôt qu'une concaténation en clair : matchKey est un identifiant interne de
   * rapprochement, jamais une donnée à afficher (voir `displayFields` pour ce que le tenant
   * voit réellement) — défense en profondeur cohérente avec KycClientService.hashApiKey.
   */
  static computeMatchKey(documentType: string, issuingCountry: string, documentNumber: string, dateOfBirth: string): string {
    const normalized = `${documentType}|${issuingCountry}|${documentNumber.trim().toUpperCase()}|${dateOfBirth}`;
    return createHash("sha256").update(normalized).digest("hex");
  }

  /**
   * `suspicious` et `manual_review_required` sont tous deux mappés vers PENDING_REVIEW : dans
   * les deux cas, un humain doit trancher plutôt que le système décide silencieusement
   * VERIFIED/UNVERIFIED (voir verdict.policy.ts pour la sémantique de chaque verdict).
   */
  private static mapVerdictToStatus(verdict: Verdict): VerifiedPersonStatus {
    switch (verdict) {
      case "authentic":
        return "VERIFIED";
      case "rejected":
        return "UNVERIFIED";
      case "suspicious":
      case "manual_review_required":
        return "PENDING_REVIEW";
    }
  }

  /**
   * Appelé par VerificationProcessor après persistance d'une VerificationRecord réussie (jamais
   * pour le chemin dégradé `persistUnprocessable` : sans identité décodée, aucun rapprochement
   * fiable n'est possible). Ne modifie JAMAIS un statut WATCHLIST existant — c'est une décision
   * humaine explicite (voir docs/tenant-portal.md), qu'une nouvelle vérification automatique ne
   * doit jamais écraser silencieusement.
   */
  async linkVerification(params: LinkVerificationParams): Promise<void> {
    const matchKey = VerifiedPersonService.computeMatchKey(
      params.documentType,
      params.issuingCountry,
      params.documentNumber,
      params.dateOfBirth,
    );
    const computedStatus = VerifiedPersonService.mapVerdictToStatus(params.verdict);

    const existing = await this.prisma.verifiedPerson.findUnique({
      where: { kycClientId_matchKey: { kycClientId: params.kycClientId, matchKey } },
    });

    const displayFields = params.displayFields as Prisma.InputJsonValue;

    if (existing) {
      const nextStatus = existing.status === "WATCHLIST" ? "WATCHLIST" : computedStatus;
      await this.prisma.verifiedPerson.update({
        where: { id: existing.id },
        data: {
          status: nextStatus,
          displayFields,
          lastVerifiedAt: new Date(),
          verificationCount: { increment: 1 },
          verifications: { connect: { id: params.verificationRecordId } },
        },
      });
      return;
    }

    await this.prisma.verifiedPerson.create({
      data: {
        kycClientId: params.kycClientId,
        matchKey,
        status: computedStatus,
        documentType: params.documentType,
        issuingCountry: params.issuingCountry,
        displayFields,
        verificationCount: 1,
        verifications: { connect: { id: params.verificationRecordId } },
      },
    });
  }
}
