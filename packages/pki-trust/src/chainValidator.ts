import type { DataGroupHash } from "@emrtd-verify/emrtd-core";
import {
  decodeSod,
  verifyDataGroupHashes,
  dataGroupsNotRead,
  isCertificateSignedBy,
  parseCertificate,
  distinguishedNameToString,
  sameCountry,
} from "@emrtd-verify/emrtd-core";
import type { CertificateSummary, TrustChainResult } from "@emrtd-verify/shared-types";
import type { CscaTrustAnchor } from "./trustAnchor";
import { isCscaValidAt } from "./trustAnchor";
import type { NationalPkdRegistry } from "./nationalPkdAdapter";
import type { ExtendedTrustStore } from "./trustStore";
import { isSerialNumberRevoked, type DecodedRevocationList } from "./crl";

export interface ChainValidationInput {
  countryCode: string;
  /** EF.SOD brut (DER), tel que lu sur la puce. */
  sodDer: Uint8Array;
  computedDataGroupHashes: DataGroupHash[];
  icaoPkdAnchors: CscaTrustAnchor[];
  nationalPkdRegistry: NationalPkdRegistry;
  extendedTrustStore: ExtendedTrustStore;
  /** CRL déjà récupérée pour le CSCA candidat, si disponible — voir docs/pki-trust-model.md "Révocation". */
  revocationList?: DecodedRevocationList;
  /** Politique du client KYC : niveaux de confiance acceptés comme "suffisants". */
  clientAcceptedLevels: Array<"high" | "medium" | "low">;
  atIso8601?: string;
}

export interface ChainValidationResult extends TrustChainResult {
  dataGroupHashMismatches: number[];
  /** DG lus dont le hash correspond au SOD. */
  dataGroupsVerified: number[];
  /** DG déclarés dans le SOD mais non lus (ex. DG3 protégé par EAC) — information, pas une anomalie. */
  dataGroupsNotRead: number[];
  /** true si aucune source de confiance n'a de CSCA pour ce pays. */
  noTrustAnchorAvailable: boolean;
  /** true si le SOD est authentiquement signé par la clé privée du certificat DSC embarqué. */
  sodSignatureValid: boolean;
  /** true si ce certificat DSC est lui-même signé par le CSCA de confiance sélectionné. */
  dscTrustedByCsca: boolean;
  /** true si la période de validité du DSC est respectée à la date de vérification. */
  dscWithinValidityPeriod: boolean;
}

/**
 * Sélectionne la meilleure ancre de confiance disponible pour le pays, dans l'ordre
 * ICAO PKD > PKD nationale > magasin étendu (voir docs/pki-trust-model.md), puis exécute
 * la Passive Authentication complète (Doc 9303 Part 11 §4) : décodage du SOD, vérification
 * de la signature SOD<-DSC, vérification de la chaîne DSC<-CSCA, périodes de validité,
 * révocation (si une CRL est fournie) et comparaison des hashs de DG.
 */
export async function validateTrustChain(input: ChainValidationInput): Promise<ChainValidationResult> {
  const atIso8601 = input.atIso8601 ?? new Date().toISOString();

  const decoded = decodeSod(input.sodDer);
  const hashVerifications = verifyDataGroupHashes(decoded.document, input.computedDataGroupHashes);
  const dataGroupHashMismatches = hashVerifications.filter((h) => !h.matches).map((h) => h.dataGroupNumber);
  const dataGroupsVerified = hashVerifications.filter((h) => h.matches).map((h) => h.dataGroupNumber);
  const notRead = dataGroupsNotRead(decoded.document, input.computedDataGroupHashes);
  const sodSignatureValid = await decoded.verifySignature();
  const signer = decoded.document.signerCertificate;
  const dsc: CertificateSummary = {
    subject: signer.subject,
    issuer: signer.issuer,
    serialNumber: signer.serialNumber,
    notBefore: signer.notBefore,
    notAfter: signer.notAfter,
  };

  // La MRZ porte un code alpha-3 (FRA, ou "D"), les CSCA l'attribut X.509 C= alpha-2 (FR) : on
  // compare les deux formes (sameCountry), sinon aucune ancre n'est jamais trouvée.
  const icaoAnchors = input.icaoPkdAnchors.filter(
    (a) => sameCountry(a.countryCode, input.countryCode) && isCscaValidAt(a, atIso8601),
  );
  const nationalAdapter = input.nationalPkdRegistry.get(input.countryCode);
  const nationalAnchors = nationalAdapter ? (await nationalAdapter.fetchCsca()).filter((a) => isCscaValidAt(a, atIso8601)) : [];
  const extendedAnchors = input.extendedTrustStore.findByCountry(input.countryCode, atIso8601);

  // Un pays a en général plusieurs CSCA valides en même temps (renouvellements, ici 8 pour la
  // France) : on retient celui qui a RÉELLEMENT signé ce DSC, dans l'ordre de priorité des sources
  // (ICAO PKD > PKD nationale > magasin étendu), et non le premier venu.
  const orderedAnchors = [...icaoAnchors, ...nationalAnchors, ...extendedAnchors];
  let candidate: CscaTrustAnchor | undefined;
  for (const anchor of orderedAnchors) {
    if (await isCertificateSignedBy(signer.certificateDer, anchor.certificateDer)) {
      candidate = anchor;
      break;
    }
  }
  const signingAnchorFound = candidate !== undefined;
  candidate ??= orderedAnchors[0];

  if (!candidate) {
    return {
      source: "extended-trust-store",
      level: "low",
      sufficientForClientPolicy: false,
      revocationChecked: false,
      revoked: false,
      dsc,
      dataGroupHashMismatches,
      dataGroupsVerified,
      dataGroupsNotRead: notRead,
      noTrustAnchorAvailable: true,
      sodSignatureValid,
      dscTrustedByCsca: false,
      dscWithinValidityPeriod:
        atIso8601 >= decoded.document.signerCertificate.notBefore &&
        atIso8601 <= decoded.document.signerCertificate.notAfter,
    };
  }

  const dscTrustedByCsca = signingAnchorFound;
  const cscaCertificate = parseCertificate(candidate.certificateDer);
  const csca: CertificateSummary = {
    subject: candidate.subject,
    issuer: distinguishedNameToString(cscaCertificate.issuer),
    serialNumber: candidate.serialNumber,
    notBefore: candidate.notBefore,
    notAfter: candidate.notAfter,
  };

  const dscWithinValidityPeriod =
    atIso8601 >= decoded.document.signerCertificate.notBefore &&
    atIso8601 <= decoded.document.signerCertificate.notAfter;

  const revocationChecked = input.revocationList !== undefined;
  const revoked =
    revocationChecked && isSerialNumberRevoked(input.revocationList!, decoded.document.signerCertificate.serialNumber);

  return {
    source: candidate.source,
    level: candidate.level,
    // Le niveau de l'ancre de confiance ne suffit pas : un SOD dont la signature ne vérifie
    // pas, un DSC qui ne remonte pas au CSCA sélectionné, ou un DSC hors période de validité
    // doivent chacun, seuls, empêcher un verdict "authentic" — voir AnomalyDetectionService
    // (SOD_SIGNATURE_INVALID/DSC_NOT_TRUSTED_BY_CSCA/DSC_EXPIRED) pour l'anomalie explicite
    // correspondante consommée par computeVerdict.
    sufficientForClientPolicy:
      input.clientAcceptedLevels.includes(candidate.level) &&
      sodSignatureValid &&
      dscTrustedByCsca &&
      dscWithinValidityPeriod,
    cscaSubject: candidate.subject,
    dscSubject: decoded.document.signerCertificate.subject,
    csca,
    dsc,
    revocationChecked,
    revoked,
    dataGroupHashMismatches,
    dataGroupsVerified,
    dataGroupsNotRead: notRead,
    noTrustAnchorAvailable: false,
    sodSignatureValid,
    dscTrustedByCsca,
    dscWithinValidityPeriod,
  };
}
