import {
  buildChipDataEnvelope,
  decodeChipDataEnvelope,
  bytesToBase64,
  parseDg14ChipAuthentication,
  verifyLivenessResponse,
  type LivenessChallenge,
  type LivenessSignalFrame,
  type LightSignalSample,
} from "@emrtd-verify/emrtd-core";
import {
  validateTrustChain,
  NationalPkdRegistry,
  loadExtendedTrustStoreFromJson,
  type CscaTrustAnchor,
  type VerifiedRevocationList,
} from "@emrtd-verify/pki-trust";
import { detectAnomalies, computeVerdict } from "@emrtd-verify/verification-policy";
import type {
  ActiveLivenessResult,
  AnomalyFinding,
  DocumentIdentity,
  DocumentType,
  FaceMatchResult,
  FieldCheck,
  Iso3166Alpha3,
  TrustChainResult,
  Verdict,
} from "@emrtd-verify/shared-types";
import type { MrzFieldValidation } from "@emrtd-verify/emrtd-core";
import { getLocalCscaAnchors } from "../pki/cscaBundleSync";
import { appConfig } from "../config";
import { compareFaces, type FaceMatchInput } from "../faceMatch/faceMatch";
import type { OnnxSessionLike, TensorConstructorLike } from "../faceMatch/embedding";

export class LocalVerificationError extends Error {}

/**
 * Résultat d'une vérification calculée entièrement sur l'appareil, sans connexion réseau — voir
 * docs/pki-trust-model.md "Vérification hors ligne". `provisional: true` n'est jamais retiré ici :
 * seule la réconciliation backend (src/sync/, obligatoire) peut produire un `VerificationResult`
 * signé faisant foi. Ni revue humaine, ni piste d'audit centralisée ne peuvent exister sur un
 * appareil déconnecté — exigence PVID (voir docs/pvid-compliance.md).
 */
export interface LocalVerificationResult {
  provisional: true;
  computedAt: string; // ISO 8601
  verdict: Verdict;
  document: {
    type: DocumentType;
    issuingCountry: Iso3166Alpha3;
    fields: Record<string, FieldCheck>;
  };
  trustChain: TrustChainResult;
  /** Détail de la Passive Authentication (Doc 9303 Part 11 §5.1). */
  passiveAuthentication: {
    sodSignatureValid: boolean;
    dscTrustedByCsca: boolean;
    dscWithinValidityPeriod: boolean;
    noTrustAnchorAvailable: boolean;
    dataGroupsVerified: number[];
    dataGroupHashMismatches: number[];
    dataGroupsNotRead: number[];
    /** CRL appliquée au DSC (date d'émission, prochaine mise à jour, périmée ou non). */
    revocationList?: { thisUpdate: string; nextUpdate?: string; stale: boolean };
  };
  /** Active Authentication : `undefined` si la puce n'a pas de DG15 (non proposée par le document). */
  activeAuthentication?: { performed: boolean; valid: boolean; reason?: string };
  /** Chip Authentication / PACE-CAM : `undefined` si DG14 n'en annonce pas. */
  chipAuthentication?: { performed: boolean; valid: boolean; protocol?: "CA" | "PACE-CAM"; reason?: string };
  /** Photo du porteur extraite de DG2 (JPEG ou JPEG 2000, affichable par <Image> sur iOS). */
  faceImage?: { dataUri: string; format: "jpeg" | "jpeg2000" };
  activeLiveness?: ActiveLivenessResult;
  faceMatch?: FaceMatchResult;
  anomalies: AnomalyFinding[];
}

function faceImageDataUri(bytes: Uint8Array | undefined): LocalVerificationResult["faceImage"] {
  if (!bytes || bytes.length < 4) return undefined;
  const format = bytes[0] === 0xff && bytes[1] === 0xd8 ? "jpeg" : "jpeg2000";
  return { format, dataUri: `data:image/${format === "jpeg" ? "jpeg" : "jp2"};base64,${bytesToBase64(bytes)}` };
}

export interface LocalVerificationInput {
  documentType: DocumentType;
  chipData: {
    sod: Uint8Array;
    dataGroups: Record<number, Uint8Array>;
    activeAuthentication?: { challenge: Uint8Array; responseDer: Uint8Array };
    /** Résultat de la Chip Authentication faite pendant la lecture (voir emrtd-core chipReader.ts). */
    chipAuthentication?: { performed: boolean; valid: boolean; protocol?: "CA" | "PACE-CAM"; reason?: string };
  };
  activeLiveness?: {
    challenge: LivenessChallenge;
    samples: LivenessSignalFrame[];
    lightSamples?: LightSignalSample[];
  };
  /**
   * Comparaison faciale on-device (voir faceMatch/faceMatch.ts) — facultative : elle demande la
   * photo DG2 et un selfie, tous deux décodés et localisés par le module natif modules/face-kit
   * (voir faceMatch/faceCrop.ts et authentik/state.ts `verifyChip`). En son absence (selfie passé,
   * pas de DG2, Android), ce signal est simplement omis du verdict — jamais un score fabriqué.
   */
  faceMatch?: {
    session: OnnxSessionLike;
    tensorConstructor: TensorConstructorLike;
    input: FaceMatchInput;
  };
  /** Champs d'identité à restituer dans `document.fields` — voir buildFieldChecks. */
  requestedFields?: string[];
  /**
   * Fournit les CRL vérifiées du pays (cache/embarquées, après une éventuelle mise à jour réseau —
   * voir pki/crlCache.ts). Absent : aucune vérification de révocation.
   */
  loadRevocationLists?: (countryCode: string, anchors: CscaTrustAnchor[]) => Promise<VerifiedRevocationList[]>;
  /** Contrôles non exigés (Réglages) : leur absence devient une information, plus un avertissement. */
  skippedChecks?: { revocation?: boolean; lostStolen?: boolean };
}

function buildFieldChecks(identity: DocumentIdentity, mrzValidation: MrzFieldValidation, requestedFields: string[]): Record<string, FieldCheck> {
  // Contrairement à apps/api (voir VerificationProcessor.buildRequestedFieldChecks), pas
  // d'intersection avec une liste "allowedFields" par client KYC ici : ce résultat local ne quitte
  // jamais l'appareil de son propre titulaire avant réconciliation (voir sync/), la minimisation
  // RGPD entre le backend et le client KYC s'applique au résultat final signé, pas à celui-ci.
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

/**
 * Calcule un verdict PROVISOIRE entièrement hors ligne : décodage SOD/DG (Passive Authentication),
 * validation de la chaîne de confiance contre le bundle CSCA synchronisé localement (voir
 * pki/cscaBundleSync.ts — ICAO PKD uniquement, PKD nationale/magasin étendu hors périmètre, voir
 * CscaBundle), Active Authentication si présentée, liveness active si un challenge a été capturé,
 * puis les mêmes détection d'anomalies et politique de verdict que le chemin serveur
 * (@emrtd-verify/verification-policy — code strictement identique, voir ce package). Comparaison
 * faciale on-device (SFace/ONNX, voir faceMatch/faceMatch.ts) si `input.faceMatch` est fourni —
 * facultative car elle suppose que l'appelant ait déjà décodé l'image DG2 (JPEG/JPEG2000, aucun
 * décodeur embarqué ici) et détecté un visage dans chaque image (aucun détecteur on-device,
 * voir la docstring de `faceMatch.ts` pour le périmètre exact). Pas de vérification du statut
 * perdu/volé (registre serveur uniquement, indisponible hors ligne — se traduit honnêtement par
 * l'anomalie LOST_STOLEN_STATUS_NOT_CHECKED, jamais par un silence).
 */
export async function computeLocalVerification(input: LocalVerificationInput): Promise<LocalVerificationResult> {
  const envelope = buildChipDataEnvelope(input.chipData);

  let decoded;
  try {
    decoded = await decodeChipDataEnvelope(envelope, input.documentType);
  } catch (error) {
    throw new LocalVerificationError(`Décodage des données de puce échoué : ${String(error)}`);
  }

  const icaoPkdAnchors = await getLocalCscaAnchors(decoded.documentIdentity.issuingState);
  let revocationLists: VerifiedRevocationList[] = [];
  if (input.loadRevocationLists) {
    try {
      revocationLists = await input.loadRevocationLists(decoded.documentIdentity.issuingState, icaoPkdAnchors);
    } catch {
      revocationLists = []; // Sans CRL exploitable : révocation « non vérifiée », signalée comme telle.
    }
  }
  const trustChain = await validateTrustChain({
    countryCode: decoded.documentIdentity.issuingState,
    sodDer: decoded.sodDer,
    computedDataGroupHashes: decoded.computedDataGroupHashes,
    icaoPkdAnchors,
    // PKD nationale (LDAP, réseau) et magasin étendu (fichier local à apps/api) restent hors du
    // périmètre hors ligne v1 — vides ici, jamais une source de confiance implicite.
    nationalPkdRegistry: new NationalPkdRegistry(),
    extendedTrustStore: loadExtendedTrustStoreFromJson([]),
    revocationLists,
    clientAcceptedLevels: appConfig.acceptedTrustLevels,
  });

  const anomalies = detectAnomalies({
    trustChain,
    mrzValidation: decoded.mrzValidation,
    activeAuthentication: decoded.activeAuthentication,
    chipAuthentication: input.chipData.chipAuthentication,
    // Attendue dès que la puce porte DG15 (clé d'AA, l'app envoie toujours le défi) ou une clé de
    // Chip Authentication dans DG14 (l'app lance toujours la CA) : AA ou CA doit alors aboutir.
    documentExpectedToSupportAaOrCa: input.chipData.dataGroups[15] !== undefined || dg14AnnouncesChipAuthentication(input.chipData.dataGroups[14]),
    // Registre perdu/volé : serveur uniquement, jamais interrogeable hors ligne — `checked: false`
    // dégrade honnêtement le verdict (voir detectAnomalies) plutôt que de prétendre l'avoir vérifié.
    // Conséquence assumée : ceci déclenche systématiquement LOST_STOLEN_STATUS_NOT_CHECKED
    // (avertissement), donc un verdict local plafonne toujours à "suspicious" au mieux — jamais
    // "authentic". C'est voulu, pas un défaut : ça rappelle en permanence que ce résultat reste
    // provisoire tant que la réconciliation backend (obligatoire, voir sync/) n'a pas eu lieu.
    lostStolenCheck: { checked: false, reported: false },
    skippedChecks: input.skippedChecks,
  });

  let activeLiveness: ActiveLivenessResult | undefined;
  if (input.activeLiveness) {
    // Contrairement au chemin serveur (VerificationProcessor), aucune vérification d'intégrité du
    // challenge n'est possible ici : le HMAC est signé avec un secret détenu uniquement par
    // apps/api (LIVENESS_CHALLENGE_SIGNING_SECRET), jamais partagé avec le mobile — seule l'analyse
    // des signaux capturés eux-mêmes (minutage/géométrie par action) est vérifiable localement.
    // La protection anti-rejeu (nonce à usage unique) N'EST PAS non plus disponible hors ligne
    // (LivenessReplayGuardService est un état serveur, Postgres) : ce résultat local reste
    // provisoire précisément pour cette raison, voir la réconciliation obligatoire (src/sync/).
    const livenessResult = verifyLivenessResponse(input.activeLiveness.challenge, {
      samples: input.activeLiveness.samples,
      lightSamples: input.activeLiveness.lightSamples,
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

  let faceMatch: FaceMatchResult | undefined;
  if (input.faceMatch) {
    faceMatch = await compareFaces(input.faceMatch.session, input.faceMatch.tensorConstructor, input.faceMatch.input);
  }

  const allFieldChecksValid =
    decoded.mrzValidation.compositeValid &&
    decoded.mrzValidation.documentNumberValid &&
    decoded.mrzValidation.dateOfBirthValid &&
    decoded.mrzValidation.dateOfExpiryValid;

  const verdict = computeVerdict({ trustChain, anomalies, faceMatch, activeLiveness, allFieldChecksValid });

  return {
    provisional: true,
    computedAt: new Date().toISOString(),
    verdict,
    document: {
      type: input.documentType,
      issuingCountry: decoded.documentIdentity.issuingState,
      fields: buildFieldChecks(decoded.documentIdentity, decoded.mrzValidation, input.requestedFields ?? []),
    },
    trustChain,
    passiveAuthentication: {
      sodSignatureValid: trustChain.sodSignatureValid,
      dscTrustedByCsca: trustChain.dscTrustedByCsca,
      dscWithinValidityPeriod: trustChain.dscWithinValidityPeriod,
      noTrustAnchorAvailable: trustChain.noTrustAnchorAvailable,
      dataGroupsVerified: trustChain.dataGroupsVerified,
      dataGroupHashMismatches: trustChain.dataGroupHashMismatches,
      dataGroupsNotRead: trustChain.dataGroupsNotRead,
      revocationList: trustChain.revocationListUsed,
    },
    faceImage: faceImageDataUri(decoded.faceImage),
    activeAuthentication:
      input.chipData.dataGroups[15] === undefined
        ? undefined
        : decoded.activeAuthentication
          ? { performed: true, valid: decoded.activeAuthentication.valid, reason: decoded.activeAuthentication.reason }
          : { performed: false, valid: false, reason: "Défi non signé par la puce" },
    chipAuthentication: input.chipData.chipAuthentication,
    activeLiveness,
    faceMatch,
    anomalies,
  };
}

function dg14AnnouncesChipAuthentication(dg14: Uint8Array | undefined): boolean {
  if (!dg14) return false;
  try {
    return parseDg14ChipAuthentication(dg14).publicKeys.length > 0;
  } catch {
    return false;
  }
}
