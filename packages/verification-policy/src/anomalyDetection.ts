import type { AnomalyFinding } from "@emrtd-verify/shared-types";
import type { ChainValidationResult } from "@emrtd-verify/pki-trust";
import type { ActiveAuthenticationVerification, MrzFieldValidation } from "@emrtd-verify/emrtd-core";

/**
 * Même shape que `LostStolenCheckResult` (apps/api/src/modules/document-status/lost-stolen-registry.ts)
 * — dupliquée ici plutôt qu'importée : ce package doit rester utilisable par apps/mobile (voir
 * docs/pki-trust-model.md "Vérification hors ligne"), qui ne peut pas dépendre d'apps/api. La
 * compatibilité structurelle de TypeScript suffit à ce qu'apps/api passe directement son propre
 * type sans conversion.
 */
export interface DocumentStatusCheckResult {
  checked: boolean;
  reported: boolean;
}

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
  /**
   * Chip Authentication (ou PACE-CAM) faite pendant la lecture — interactive, donc constatée par
   * le lecteur lui-même (packages/emrtd-core/src/nfc/chipReader.ts). `performed && !valid` : la
   * puce a accepté l'échange mais n'a pas prouvé détenir la clé privée de DG14.
   */
  chipAuthentication?: { performed: boolean; valid: boolean; reason?: string };
  documentExpectedToSupportAaOrCa: boolean;
  cscaExpiresWithinDays?: number;
  /**
   * Résultat d'une interrogation d'un registre de statut perdu/volé — jamais optionnel : l'appel
   * est toujours tenté côté appelant, et son résultat "non vérifiable" (checked: false) doit
   * lui-même produire un signal explicite, jamais être silencieusement omis.
   */
  lostStolenCheck: DocumentStatusCheckResult;
  /**
   * Contrôles que l'opérateur a choisi de ne pas exiger (Réglages de l'app mobile) : faute de CRL
   * ou de registre perdu/volé joignable, leur absence n'est alors plus un avertissement (qui
   * plafonne le verdict à "suspicious") mais une simple information, toujours visible. Un résultat
   * POSITIF (DSC révoqué, document signalé) reste critique quel que soit ce réglage.
   */
  skippedChecks?: { revocation?: boolean; lostStolen?: boolean };
}

/**
 * Recoupe tous les signaux disponibles en une liste d'anomalies avec sévérité — voir
 * docs/verification-checklist.md §5 pour la correspondance exacte. Ne bloque jamais
 * silencieusement : chaque signal produit un AnomalyFinding explicite plutôt qu'un simple rejet,
 * pour que le consommateur KYC comprenne le "pourquoi". Fonction pure et portable (Node ET React
 * Native) — appelée à l'identique par apps/api (chemin en ligne, voir AnomalyDetectionService) et
 * apps/mobile (chemin hors ligne, voir docs/pki-trust-model.md "Vérification hors ligne").
 */
export function detectAnomalies(input: AnomalyDetectionInput): AnomalyFinding[] {
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

  // Sans CRL vérifiée et à jour pour le pays (non publiée, injoignable, périmée — voir
  // apps/api CrlService et apps/mobile crlCache), validateTrustChain renvoie
  // revocationChecked:false. Sans ce signal, un DSC révoqué mais non signalé serait
  // accepté silencieusement — le remonter en avertissement dégrade le verdict (computeVerdict)
  // au lieu de laisser une révocation potentielle invisible. Omis quand aucune ancre de
  // confiance n'existe (déjà critique via NO_TRUST_ANCHOR, la révocation y est sans objet).
  if (!input.trustChain.noTrustAnchorAvailable && !input.trustChain.revocationChecked) {
    findings.push(
      input.skippedChecks?.revocation
        ? {
            code: "REVOCATION_CHECK_DISABLED",
            severity: "info",
            message: "Contrôle de révocation du DSC (CRL) désactivé dans les réglages — statut non vérifié",
          }
        : {
            code: "REVOCATION_NOT_CHECKED",
            severity: "warning",
            message: "Statut de révocation du DSC non vérifiable (aucune CRL disponible) — ne pas traiter comme non révoqué",
          },
    );
  }

  const aa = input.activeAuthentication;
  const ca = input.chipAuthentication;
  const caProven = ca?.performed === true && ca.valid;
  if (ca?.performed && !ca.valid) {
    // Même gravité qu'un échec d'AA : les données (dont DG14) sont authentiques, mais la puce ne
    // détient pas la clé privée correspondante — copie des données sur une autre puce.
    findings.push({
      code: "CHIP_AUTHENTICATION_FAILED",
      severity: "critical",
      message: `Échec de la Chip Authentication : la puce ne détient pas la clé privée de DG14${ca.reason ? ` (${ca.reason})` : ""}`,
    });
  }

  if (!aa) {
    if (input.documentExpectedToSupportAaOrCa && !caProven && !(ca?.performed && !ca.valid)) {
      findings.push({
        code: "MISSING_ACTIVE_CHIP_AUTH",
        severity: "warning",
        message: `Active/Chip Authentication absente alors que le document devrait la supporter (indice possible de clonage)${ca?.reason ? ` — ${ca.reason}` : ""}`,
      });
    }
  } else if (aa.supported && !aa.valid) {
    // Le défi a été signé, mais pas avec la clé privée correspondant à DG15 : la puce ne
    // possède pas la clé attendue — signal fort de clonage (SOD copié sans la clé privée),
    // bien plus grave qu'une simple absence d'AA (voir docs/verification-checklist.md §2).
    findings.push({
      code: "ACTIVE_AUTHENTICATION_FAILED",
      severity: "critical",
      message: "Échec de la vérification Active/Chip Authentication : la puce ne détient pas la clé privée attendue",
    });
  } else if (!aa.supported && !caProven) {
    findings.push({
      code: "ACTIVE_AUTHENTICATION_UNSUPPORTED_ALGORITHM",
      severity: "info",
      message: aa.reason ?? "Algorithme Active Authentication non supporté par cette implémentation",
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
    findings.push(
      input.skippedChecks?.lostStolen
        ? {
            code: "LOST_STOLEN_CHECK_DISABLED",
            severity: "info",
            message: "Contrôle du registre des documents perdus/volés désactivé dans les réglages — statut non vérifié",
          }
        : {
            code: "LOST_STOLEN_STATUS_NOT_CHECKED",
            severity: "warning",
            message: "Statut perdu/volé non vérifiable (registre non configuré ou indisponible) — ne pas traiter comme non signalé",
          },
    );
  }

  return findings;
}
