import { Injectable } from "@nestjs/common";
import type { AnomalyFinding } from "@emrtd-verify/shared-types";
import type { ChainValidationResult } from "@emrtd-verify/pki-trust";
import type { ActiveAuthenticationVerification, MrzFieldValidation } from "@emrtd-verify/emrtd-core";
import type { LostStolenCheckResult } from "../document-status/lost-stolen-registry";

export interface AnomalyDetectionInput {
  trustChain: ChainValidationResult;
  mrzValidation: MrzFieldValidation;
  /**
   * Résultat de la vérification cryptographique Active/Chip Authentication — undefined si le
   * document ne l'a pas présentée du tout (voir `documentExpectedToSupportAaOrCa` pour savoir
   * si c'est anormal), sinon le résultat réel de `verifyActiveAuthenticationResponse`
   * (packages/emrtd-core/src/lds/activeAuthentication.ts).
   */
  activeAuthentication?: ActiveAuthenticationVerification;
  documentExpectedToSupportAaOrCa: boolean;
  cscaExpiresWithinDays?: number;
  /**
   * Résultat de DocumentStatusService.checkStatus — jamais optionnel : l'appel est toujours
   * tenté (voir VerificationProcessor), et son résultat "non vérifiable" (checked: false) doit
   * lui-même produire un signal explicite, jamais être silencieusement omis.
   */
  lostStolenCheck: LostStolenCheckResult;
}

/**
 * Recoupe tous les signaux disponibles en une liste d'anomalies avec sévérité —
 * voir docs/verification-checklist.md §5 pour la correspondance exacte.
 * Ne bloque jamais silencieusement : chaque signal produit un AnomalyFinding explicite
 * plutôt qu'un simple rejet, pour que le consommateur KYC comprenne le "pourquoi".
 */
@Injectable()
export class AnomalyDetectionService {
  detect(input: AnomalyDetectionInput): AnomalyFinding[] {
    const findings: AnomalyFinding[] = [];

    if (input.trustChain.dataGroupHashMismatches.length > 0) {
      findings.push({
        code: "DG_HASH_MISMATCH",
        severity: "critical",
        message: `Hash déclaré dans le SOD différent du hash calculé pour DG ${input.trustChain.dataGroupHashMismatches.join(", ")}`,
      });
    }

    if (input.trustChain.noTrustAnchorAvailable) {
      findings.push({
        code: "NO_TRUST_ANCHOR",
        severity: "critical",
        message: "Aucun CSCA de confiance disponible (ICAO PKD, PKD nationale, magasin étendu) pour ce pays",
      });
    } else if (input.trustChain.level === "low") {
      findings.push({
        code: "LOW_TRUST_LEVEL",
        severity: "warning",
        message: "Chaîne de confiance validée uniquement via le magasin de confiance étendu, niveau bas",
      });
    }

    if (input.trustChain.revoked) {
      findings.push({
        code: "CSCA_REVOKED",
        severity: "critical",
        message: "Le certificat CSCA/DSC utilisé est révoqué",
      });
    }

    if (!input.trustChain.sodSignatureValid) {
      findings.push({
        code: "SOD_SIGNATURE_INVALID",
        severity: "critical",
        message: "La signature du SOD ne vérifie pas avec la clé publique du DSC déclaré (donnée potentiellement falsifiée)",
      });
    }

    if (!input.trustChain.noTrustAnchorAvailable && !input.trustChain.dscTrustedByCsca) {
      findings.push({
        code: "DSC_NOT_TRUSTED_BY_CSCA",
        severity: "critical",
        message: "Le DSC embarqué dans le document n'est pas signé par le CSCA de confiance sélectionné pour ce pays",
      });
    }

    if (!input.trustChain.dscWithinValidityPeriod) {
      findings.push({
        code: "DSC_EXPIRED",
        severity: "critical",
        message: "Le certificat DSC est hors de sa période de validité à la date de vérification",
      });
    }

    // La récupération/persistance de CRL n'est pas encore câblée en production (voir
    // docs/pki-trust-model.md "Révocation" et docs/roadmap.md) : validateTrustChain reçoit alors
    // toujours revocationChecked:false. Sans ce signal, un DSC révoqué mais non signalé serait
    // accepté silencieusement — le remonter en avertissement dégrade le verdict (computeVerdict)
    // au lieu de laisser une révocation potentielle invisible. Omis quand aucune ancre de
    // confiance n'existe (déjà critique via NO_TRUST_ANCHOR, la révocation y est sans objet).
    if (!input.trustChain.noTrustAnchorAvailable && !input.trustChain.revocationChecked) {
      findings.push({
        code: "REVOCATION_NOT_CHECKED",
        severity: "warning",
        message: "Statut de révocation du DSC non vérifiable (aucune CRL disponible) — ne pas traiter comme non révoqué",
      });
    }

    if (!input.activeAuthentication) {
      if (input.documentExpectedToSupportAaOrCa) {
        findings.push({
          code: "MISSING_ACTIVE_CHIP_AUTH",
          severity: "warning",
          message: "Active/Chip Authentication absente alors que le document devrait la supporter (indice possible de clonage)",
        });
      }
    } else if (input.activeAuthentication.supported && !input.activeAuthentication.valid) {
      // Le défi a été signé, mais pas avec la clé privée correspondant à DG15 : la puce ne
      // possède pas la clé attendue — signal fort de clonage (SOD copié sans la clé privée),
      // bien plus grave qu'une simple absence d'AA (voir docs/verification-checklist.md §2).
      findings.push({
        code: "ACTIVE_AUTHENTICATION_FAILED",
        severity: "critical",
        message: "Échec de la vérification Active/Chip Authentication : la puce ne détient pas la clé privée attendue",
      });
    } else if (!input.activeAuthentication.supported) {
      findings.push({
        code: "ACTIVE_AUTHENTICATION_UNSUPPORTED_ALGORITHM",
        severity: "info",
        message: input.activeAuthentication.reason ?? "Algorithme Active Authentication non supporté par cette implémentation",
      });
    }

    if (!input.mrzValidation.compositeValid) {
      findings.push({
        code: "MRZ_COMPOSITE_INVALID",
        severity: "critical",
        message: "Chiffre de contrôle composite MRZ invalide",
      });
    }

    if (input.cscaExpiresWithinDays !== undefined && input.cscaExpiresWithinDays < 90) {
      findings.push({
        code: "CSCA_EXPIRING_SOON",
        severity: "info",
        message: `Le CSCA utilisé expire dans ${input.cscaExpiresWithinDays} jours`,
      });
    }

    // Bonne pratique ENISA la plus citée après la lecture NFC (voir docs/pvid-compliance.md) —
    // un document parfaitement valide cryptographiquement peut avoir été déclaré perdu/volé,
    // mécanisme distinct de la révocation CSCA/DSC (CRL) ci-dessus.
    if (input.lostStolenCheck.reported) {
      findings.push({
        code: "DOCUMENT_REPORTED_LOST_OR_STOLEN",
        severity: "critical",
        message: "Ce document est signalé perdu ou volé dans le registre interrogé",
      });
    } else if (!input.lostStolenCheck.checked) {
      findings.push({
        code: "LOST_STOLEN_STATUS_NOT_CHECKED",
        severity: "warning",
        message: "Statut perdu/volé non vérifiable (registre non configuré ou indisponible) — ne pas traiter comme non signalé",
      });
    }

    return findings;
  }
}
