import { Injectable } from "@nestjs/common";
import type { AnomalyFinding } from "@emrtd-verify/shared-types";
import type { ChainValidationResult } from "@emrtd-verify/pki-trust";
import type { ActiveAuthenticationVerification, MrzFieldValidation } from "@emrtd-verify/emrtd-core";

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

    return findings;
  }
}
