import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import type { Prisma } from "@prisma/client";
import type { AnomalyFinding, FaceMatchResult, FieldCheck, VerificationResult } from "@emrtd-verify/shared-types";
import type { DocumentIdentity } from "@emrtd-verify/shared-types";
import type { MrzFieldValidation } from "@emrtd-verify/emrtd-core";
import { PrismaService } from "../prisma/prisma.service";
import { PkiTrustService } from "../pki/pki-trust.service";
import { AnomalyDetectionService } from "../anomaly-detection/anomaly-detection.service";
import { FaceMatchClient } from "../face-match/face-match.client";
import { AuditService } from "../audit/audit.service";
import { ResultSignerService } from "./result-signer.service";
import { MetricsService } from "../metrics/metrics.service";
import { VerifiedPersonService } from "../verified-person/verified-person.service";
import { DocumentStatusService } from "../document-status/document-status.service";
import type { TrustLevel } from "../kyc/kyc-client.service";
import { computeVerdict } from "./verdict.policy";
import { decodeChipData, type DecodedChipData } from "./chip-data.decoder";
import type { SubmitVerificationDto } from "./dto/submit-verification.dto";

export interface VerificationJobData {
  verificationId: string;
  dto: SubmitVerificationDto;
  clientId: string;
  /** Politique de risque du client authentifié (KycClientService) — voir docs/pki-trust-model.md. */
  clientAcceptedLevels: TrustLevel[];
  /** Champs d'identité que ce client est autorisé à recevoir (minimisation RGPD). */
  allowedFields: string[];
}

/**
 * Worker BullMQ traitant une vérification de bout en bout : validation de la chaîne de
 * confiance PKI, détection d'anomalies, comparaison faciale, verdict, persistance et
 * journalisation d'audit. Déclaré dans VerificationWorkerModule, tourne dans le processus
 * worker séparé (`apps/api/src/worker.ts`), jamais dans le processus API HTTP — voir
 * docs/roadmap.md Phase 6 "processus séparé".
 */
@Processor("verification")
export class VerificationProcessor extends WorkerHost {
  private readonly logger = new Logger(VerificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pkiTrust: PkiTrustService,
    private readonly anomalyDetection: AnomalyDetectionService,
    private readonly faceMatchClient: FaceMatchClient,
    private readonly auditService: AuditService,
    private readonly resultSigner: ResultSignerService,
    private readonly metrics: MetricsService,
    private readonly verifiedPerson: VerifiedPersonService,
    private readonly documentStatus: DocumentStatusService,
  ) {
    super();
  }

  async process(job: Job<VerificationJobData>): Promise<void> {
    const { verificationId, dto, clientId, clientAcceptedLevels, allowedFields } = job.data;
    const startedAt = process.hrtime.bigint();

    let decoded: DecodedChipData;
    try {
      decoded = decodeChipData(dto.chipData);
    } catch (error) {
      this.logger.warn(
        `Extraction des données de puce indisponible pour ${verificationId} (voir docs/roadmap.md Phase 4) : ${String(error)}`,
      );
      await this.persistUnprocessable(verificationId, dto, clientId, String(error));
      this.metrics.observeProcessingDuration(elapsedSeconds(startedAt));
      return;
    }

    const trustChain = await this.pkiTrust.validate({
      countryCode: decoded.documentIdentity.issuingState,
      sodDer: decoded.sodDer,
      computedDataGroupHashes: decoded.computedDataGroupHashes,
      clientAcceptedLevels,
    });
    this.metrics.recordTrustChain(trustChain.source, trustChain.level);

    // Bonne pratique ENISA (voir docs/pvid-compliance.md) — mécanisme distinct de la révocation
    // CSCA/DSC ci-dessus, jamais bloquant en soi : DocumentStatusService.checkStatus n'échoue
    // jamais (absorbe toute erreur), voir AnomalyDetectionService pour l'interprétation.
    const lostStolenCheck = await this.documentStatus.checkStatus({
      issuingState: decoded.documentIdentity.issuingState,
      documentNumber: decoded.documentIdentity.documentNumber,
    });

    const anomalies: AnomalyFinding[] = this.anomalyDetection.detect({
      trustChain,
      mrzValidation: decoded.mrzValidation,
      activeAuthentication: decoded.activeAuthentication,
      // Doc 9303 Part 11 §5/§6 : AA/CA sont attendues sur les ePassports, pas systématiquement
      // sur les eID/titres de séjour selon le profil national.
      documentExpectedToSupportAaOrCa: dto.documentType === "ePassport",
      lostStolenCheck,
    });

    let faceMatch: FaceMatchResult | undefined;
    if (dto.liveCapture && decoded.faceImage) {
      try {
        faceMatch = await this.faceMatchClient.compare({
          referenceImage: decoded.faceImage,
          probeImage: Buffer.from(dto.liveCapture, "base64"),
        });
      } catch (error) {
        // services/face-match indisponible (timeout/disjoncteur ouvert/erreur) ne doit jamais
        // faire échouer tout le job : on dégrade en anomalie explicite plutôt qu'en job en échec
        // silencieux, pour que le verdict final reflète l'incertitude (voir verdict.policy.ts).
        this.logger.warn(`services/face-match indisponible pour ${verificationId} : ${String(error)}`);
        anomalies.push({
          code: "FACE_MATCH_UNAVAILABLE",
          severity: "warning",
          message: "Comparaison faciale indisponible (service en échec) — revue manuelle requise",
        });
      }
    }

    if (faceMatch?.livenessPassed) {
      // services/face-match ne fait aujourd'hui QUE de la liveness passive (résolution, netteté,
      // unicité du visage) — pas de détection anti-spoofing forte contre photo/rejeu/masque/
      // deepfake (voir docs/facial-recognition.md "Détection de vivacité — périmètre honnête").
      // Un `livenessPassed: true` de ce module ne doit donc jamais, à lui seul, contribuer à un
      // verdict "authentic" automatisé : le traiter comme contrôle de qualité seulement, en
      // dégradant systématiquement vers "suspicious" (revue possible), jusqu'à ce qu'une liveness
      // active soit implémentée (voir docs/roadmap.md).
      anomalies.push({
        code: "LIVENESS_PASSIVE_ONLY",
        severity: "warning",
        message: "Liveness validée uniquement par des heuristiques passives (pas une protection anti-spoofing forte)",
      });
    }

    const allFieldChecksValid =
      decoded.mrzValidation.compositeValid &&
      decoded.mrzValidation.documentNumberValid &&
      decoded.mrzValidation.dateOfBirthValid &&
      decoded.mrzValidation.dateOfExpiryValid;

    const verdict = computeVerdict({ trustChain, anomalies, faceMatch, allFieldChecksValid });
    for (const anomaly of anomalies) {
      this.metrics.recordAnomaly(anomaly.code, anomaly.severity);
    }
    this.metrics.recordVerification(verdict, decoded.documentIdentity.issuingState);

    const resultWithoutSignature: Omit<VerificationResult, "signature"> = {
      verificationId,
      verdict,
      document: {
        type: dto.documentType,
        issuingCountry: decoded.documentIdentity.issuingState,
        fields: buildRequestedFieldChecks(
          decoded.documentIdentity,
          decoded.mrzValidation,
          intersectRequestedFields(dto.requestedFields ?? [], allowedFields),
        ),
      },
      trustChain,
      faceMatch,
      anomalies,
      verifiedAt: new Date().toISOString(),
    };
    const result: VerificationResult = { ...resultWithoutSignature, signature: await this.resultSigner.sign(resultWithoutSignature) };

    const persisted = await this.persist(result, clientId);
    // Jamais dans persistUnprocessable() : sans identité décodée (documentNumber/dateOfBirth),
    // aucun rapprochement VerifiedPerson fiable n'est possible — voir VerifiedPersonService.
    await this.verifiedPerson.linkVerification({
      kycClientId: clientId,
      verificationRecordId: persisted.id,
      documentType: dto.documentType,
      issuingCountry: decoded.documentIdentity.issuingState,
      documentNumber: decoded.documentIdentity.documentNumber,
      dateOfBirth: decoded.documentIdentity.dateOfBirth,
      verdict,
      displayFields: resultWithoutSignature.document.fields,
    });
    this.metrics.observeProcessingDuration(elapsedSeconds(startedAt));
  }

  private async persist(result: VerificationResult, clientId: string): Promise<{ id: string }> {
    const record = await this.prisma.verificationRecord.create({
      data: {
        verificationId: result.verificationId,
        clientId,
        documentType: result.document.type,
        issuingCountry: result.document.issuingCountry,
        verdict: result.verdict,
        trustChainSource: result.trustChain.source,
        trustChainLevel: result.trustChain.level,
        result: result as unknown as Prisma.InputJsonValue,
      },
    });

    await this.auditService.record({
      verificationId: result.verificationId,
      clientId,
      verdict: result.verdict,
      trustChainSource: result.trustChain.source,
      anomalyCodes: result.anomalies.map((a) => a.code),
      occurredAt: result.verifiedAt,
    });

    return { id: record.id };
  }

  /**
   * Chemin de dégradation quand l'extraction des données de puce échoue (voir chip-data.decoder.ts) :
   * produit un `manual_review_required` explicite plutôt que de laisser le job échouer sans
   * résultat consultable par `GET /v1/verifications/:id`.
   */
  private async persistUnprocessable(
    verificationId: string,
    dto: SubmitVerificationDto,
    clientId: string,
    reason: string,
  ): Promise<void> {
    const resultWithoutSignature: Omit<VerificationResult, "signature"> = {
      verificationId,
      verdict: "manual_review_required",
      document: {
        type: dto.documentType,
        // "ZZZ" : code réservé ISO 3166-1 utilisé ici pour signaler un pays non déterminé
        // (l'extraction MRZ elle-même a échoué), jamais retourné pour un document traité.
        issuingCountry: "ZZZ",
        fields: {},
      },
      trustChain: {
        source: "extended-trust-store",
        level: "low",
        sufficientForClientPolicy: false,
        revocationChecked: false,
        revoked: false,
      },
      anomalies: [
        {
          code: "CHIP_DECODE_UNAVAILABLE",
          severity: "critical",
          message: `Extraction des données de puce indisponible : ${reason}`,
        },
      ],
      verifiedAt: new Date().toISOString(),
    };
    const result: VerificationResult = { ...resultWithoutSignature, signature: await this.resultSigner.sign(resultWithoutSignature) };

    this.metrics.recordTrustChain(result.trustChain.source, result.trustChain.level);
    for (const anomaly of result.anomalies) {
      this.metrics.recordAnomaly(anomaly.code, anomaly.severity);
    }
    this.metrics.recordVerification(result.verdict, result.document.issuingCountry);

    await this.persist(result, clientId);
  }
}

/** Durée écoulée en secondes depuis `startedAt` (obtenu via `process.hrtime.bigint()`), pour l'histogramme Prometheus. */
function elapsedSeconds(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1e9;
}

/**
 * Défense en profondeur pour la minimisation RGPD : un client ne peut jamais recevoir un champ
 * hors de ceux que son enregistrement KycClient autorise (`allowedFields`), même s'il le
 * demande explicitement dans `requestedFields` — les deux listes doivent s'accorder.
 */
function intersectRequestedFields(requestedFields: string[], allowedFields: string[]): string[] {
  return requestedFields.filter((field) => allowedFields.includes(field));
}

/**
 * Minimisation RGPD (article 5.1.c, voir docs/gdpr-compliance.md) : sans champs explicitement
 * demandés, aucun champ d'identité n'est restitué — seuls verdict/trustChain/anomalies le sont
 * par défaut.
 */
function buildRequestedFieldChecks(
  identity: DocumentIdentity,
  mrzValidation: MrzFieldValidation,
  requestedFields: string[],
): Record<string, FieldCheck> {
  const available: Record<string, FieldCheck> = {
    documentNumber: { value: identity.documentNumber, valid: mrzValidation.documentNumberValid, checks: ["checkDigit"] },
    dateOfBirth: { value: identity.dateOfBirth, valid: mrzValidation.dateOfBirthValid, checks: ["checkDigit"] },
    dateOfExpiry: { value: identity.dateOfExpiry, valid: mrzValidation.dateOfExpiryValid, checks: ["checkDigit"] },
    nationality: { value: identity.nationality, valid: true, checks: [] },
    sex: { value: identity.sex, valid: true, checks: [] },
    primaryIdentifier: { value: identity.primaryIdentifier, valid: true, checks: [] },
    secondaryIdentifier: { value: identity.secondaryIdentifier ?? "", valid: true, checks: [] },
  };

  return Object.fromEntries(Object.entries(available).filter(([key]) => requestedFields.includes(key)));
}
