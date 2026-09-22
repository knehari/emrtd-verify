import {
  buildChipDataEnvelope,
  decodeChipDataEnvelope,
  verifyLivenessResponse,
  type LivenessChallenge,
  type LivenessSignalFrame,
  type LightSignalSample,
} from "@emrtd-verify/emrtd-core";
import { validateTrustChain, NationalPkdRegistry, loadExtendedTrustStoreFromJson } from "@emrtd-verify/pki-trust";
import { detectAnomalies, computeVerdict } from "@emrtd-verify/verification-policy";
import type {
  ActiveLivenessResult,
  AnomalyFinding,
  DocumentIdentity,
  DocumentType,
  FieldCheck,
  Iso3166Alpha3,
  TrustChainResult,
  Verdict,
} from "@emrtd-verify/shared-types";
import type { MrzFieldValidation } from "@emrtd-verify/emrtd-core";
import { getLocalCscaAnchors } from "../pki/cscaBundleSync";
import { appConfig } from "../config";

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
  activeLiveness?: ActiveLivenessResult;
  anomalies: AnomalyFinding[];
}

export interface LocalVerificationInput {
  documentType: DocumentType;
  chipData: {
    sod: Uint8Array;
    dataGroups: Record<number, Uint8Array>;
    activeAuthentication?: { challenge: Uint8Array; responseDer: Uint8Array };
  };
  activeLiveness?: {
    challenge: LivenessChallenge;
    samples: LivenessSignalFrame[];
    lightSamples?: LightSignalSample[];
  };
  /** Champs d'identité à restituer dans `document.fields` — voir buildFieldChecks. */
  requestedFields?: string[];
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
 * (@emrtd-verify/verification-policy — code strictement identique, voir ce package). Pas de
 * comparaison faciale à ce stade (voir src/verification/faceMatch.ts, câblé séparément) ni de
 * vérification du statut perdu/volé (registre serveur uniquement, indisponible hors ligne — se
 * traduit honnêtement par l'anomalie LOST_STOLEN_STATUS_NOT_CHECKED, jamais par un silence).
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
  const trustChain = await validateTrustChain({
    countryCode: decoded.documentIdentity.issuingState,
    sodDer: decoded.sodDer,
    computedDataGroupHashes: decoded.computedDataGroupHashes,
    icaoPkdAnchors,
    // PKD nationale (LDAP, réseau) et magasin étendu (fichier local à apps/api) restent hors du
    // périmètre hors ligne v1 — vides ici, jamais une source de confiance implicite.
    nationalPkdRegistry: new NationalPkdRegistry(),
    extendedTrustStore: loadExtendedTrustStoreFromJson([]),
    clientAcceptedLevels: appConfig.acceptedTrustLevels,
  });

  const anomalies = detectAnomalies({
    trustChain,
    mrzValidation: decoded.mrzValidation,
    activeAuthentication: decoded.activeAuthentication,
    documentExpectedToSupportAaOrCa: input.documentType === "ePassport",
    // Registre perdu/volé : serveur uniquement, jamais interrogeable hors ligne — `checked: false`
    // dégrade honnêtement le verdict (voir detectAnomalies) plutôt que de prétendre l'avoir vérifié.
    // Conséquence assumée : ceci déclenche systématiquement LOST_STOLEN_STATUS_NOT_CHECKED
    // (avertissement), donc un verdict local plafonne toujours à "suspicious" au mieux — jamais
    // "authentic". C'est voulu, pas un défaut : ça rappelle en permanence que ce résultat reste
    // provisoire tant que la réconciliation backend (obligatoire, voir sync/) n'a pas eu lieu.
    lostStolenCheck: { checked: false, reported: false },
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

  const allFieldChecksValid =
    decoded.mrzValidation.compositeValid &&
    decoded.mrzValidation.documentNumberValid &&
    decoded.mrzValidation.dateOfBirthValid &&
    decoded.mrzValidation.dateOfExpiryValid;

  const verdict = computeVerdict({ trustChain, anomalies, activeLiveness, allFieldChecksValid });

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
    activeLiveness,
    anomalies,
  };
}
