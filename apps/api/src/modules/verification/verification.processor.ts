import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import type { Prisma } from "@prisma/client";
import type {
  ActiveLivenessResult,
  AnomalyFinding,
  DeviceAttestationSummary,
  FaceMatchResult,
  FieldCheck,
  VerificationResult,
} from "@emrtd-verify/shared-types";
import type { DocumentIdentity } from "@emrtd-verify/shared-types";
import type { MrzFieldValidation } from "@emrtd-verify/emrtd-core";
import { verifyLivenessResponse } from "@emrtd-verify/emrtd-core";
import { PrismaService } from "../prisma/prisma.service";
import { PkiTrustService } from "../pki/pki-trust.service";
import { AnomalyDetectionService } from "../anomaly-detection/anomaly-detection.service";
import { FaceMatchClient } from "../face-match/face-match.client";
import { AuditService } from "../audit/audit.service";
import { ResultSignerService } from "./result-signer.service";
import { LivenessChallengeService } from "./liveness-challenge.service";
import { LivenessReplayGuardService } from "./liveness-replay-guard.service";
import { DeviceAttestationService } from "./device-attestation.service";
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
  /** Registre perdus/volés exigé par le client (absent sur les jobs antérieurs : exigé). */
  lostStolenCheckRequired?: boolean;
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
    private readonly livenessChallenge: LivenessChallengeService,
    private readonly livenessReplayGuard: LivenessReplayGuardService,
    private readonly deviceAttestation: DeviceAttestationService,
  ) {
    super();
  }

  async process(job: Job<VerificationJobData>): Promise<void> {
    const { verificationId, dto, clientId, clientAcceptedLevels, allowedFields, lostStolenCheckRequired } = job.data;
    const startedAt = process.hrtime.bigint();

    let decoded: DecodedChipData;
    try {
      decoded = await decodeChipData(dto.chipData, dto.documentType);
    } catch (error) {
      this.logger.warn(
        `Extraction des données de puce échouée pour ${verificationId} (chipData structurellement invalide ou illisible) : ${String(error)}`,
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
      // Politique du client : registre non exigé → un statut non vérifié n'est qu'une information.
      skippedChecks: { lostStolen: lostStolenCheckRequired === false },
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

    // Liveness ACTIVE (challenge-réponse à séquence d'actions aléatoire — voir
    // packages/emrtd-core/src/liveness/ et docs/facial-recognition.md "Détection de vivacité
    // active"). Toujours revérifiée ici, jamais faite confiance à un booléen envoyé par le mobile :
    // même discipline que la vérification du MAC avant déchiffrement dans nfc/bac.ts.
    let activeLiveness: ActiveLivenessResult | undefined;
    if (dto.activeLiveness) {
      if (!this.livenessChallenge.verifyChallengeIntegrity(dto.activeLiveness)) {
        // Signature HMAC invalide : le challenge soumis ne correspond pas à celui émis par ce
        // serveur (fenêtres temporelles/expiry potentiellement forgées) — signal de falsification
        // sans ambiguïté, jamais une simple imperfection utilisateur.
        anomalies.push({
          code: "ACTIVE_LIVENESS_CHALLENGE_INVALID",
          severity: "critical",
          message: "Le challenge de liveness active soumis ne correspond pas à un challenge émis par ce serveur (signature invalide)",
        });
        activeLiveness = { performed: true, passed: false, method: "active_challenge_response" };
      } else if (
        !(await this.livenessReplayGuard.tryConsume(
          dto.activeLiveness.challenge.nonce,
          new Date(dto.activeLiveness.challenge.expiresAt),
        ))
      ) {
        // Nonce déjà consommé : ce challenge (pourtant signé authentique) a déjà servi pour une
        // soumission précédente — rejeu sans ambiguïté, distinct d'une falsification du contenu.
        anomalies.push({
          code: "ACTIVE_LIVENESS_REPLAYED",
          severity: "critical",
          message: "Ce challenge de liveness active a déjà été soumis (rejeu détecté)",
        });
        activeLiveness = { performed: true, passed: false, method: "active_challenge_response" };
      } else {
        const livenessResult = verifyLivenessResponse(dto.activeLiveness.challenge, {
          samples: dto.activeLiveness.samples,
          lightSamples: dto.activeLiveness.lightSamples,
        });
        activeLiveness = { performed: true, passed: livenessResult.passed, method: "active_challenge_response" };
        if (!livenessResult.passed) {
          anomalies.push({
            code: "ACTIVE_LIVENESS_FAILED",
            severity: "warning",
            message: `Challenge de liveness active échoué : ${livenessResult.reasons.join(", ") || "au moins une action non détectée dans sa fenêtre"}`,
          });
        }
      }
    }

    // Intégrité de l'application/l'appareil (App Attest iOS / Play Integrity Android) — voir
    // DeviceAttestationService. Signal complémentaire, jamais décisif à lui seul aujourd'hui : la
    // vérification cryptographique réelle (chaîne de certificats Apple / clés publiques Google)
    // n'est pas implémentée dans cet environnement (voir la documentation de ce service), donc
    // `verified` y est toujours `false` — traité comme "non vérifié" (sévérité info, n'affecte pas
    // le verdict), jamais comme un signal de fraude actif tant que la vérification réelle n'existe
    // pas. Ne jamais confondre "non vérifié" et "verdict dégradé" ici.
    let deviceAttestation: DeviceAttestationSummary | undefined;
    if (dto.deviceAttestation) {
      const attestationResult = await this.deviceAttestation.verify(dto.deviceAttestation);
      deviceAttestation = { platform: attestationResult.platform, verified: attestationResult.verified };
      if (!attestationResult.verified) {
        anomalies.push({
          code: "DEVICE_ATTESTATION_NOT_VERIFIED",
          severity: "info",
          message: `Intégrité de l'application/l'appareil non vérifiée (${attestationResult.reason})`,
        });
      }
    }

    if (faceMatch?.livenessPassed && !activeLiveness?.passed) {
      // services/face-match ne fait aujourd'hui QUE de la liveness passive (résolution, netteté,
      // unicité du visage) — pas de détection anti-spoofing forte contre photo/rejeu/masque/
      // deepfake (voir docs/facial-recognition.md "Détection de vivacité — périmètre honnête").
      // Un `livenessPassed: true` de ce module ne doit donc jamais, à lui seul, contribuer à un
      // verdict "authentic" automatisé : le traiter comme contrôle de qualité seulement, en
      // dégradant systématiquement vers "suspicious" (revue possible) — SAUF si une liveness
      // active a réellement été exécutée et validée pour ce même live capture, auquel cas cette
      // preuve plus forte rend l'avertissement redondant.
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

    const verdict = computeVerdict({ trustChain, anomalies, faceMatch, activeLiveness, allFieldChecksValid });
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
      activeLiveness,
      deviceAttestation,
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
