import type { SecurityObjectDocument, DataGroupHash } from "@emrtd-verify/emrtd-core";
import { verifyDataGroupHashes } from "@emrtd-verify/emrtd-core";
import type { TrustChainResult } from "@emrtd-verify/shared-types";
import type { CscaTrustAnchor } from "./trustAnchor";
import { isCscaValidAt } from "./trustAnchor";
import type { NationalPkdRegistry } from "./nationalPkdAdapter";
import type { ExtendedTrustStore } from "./trustStore";

export interface ChainValidationInput {
  countryCode: string;
  sod: SecurityObjectDocument;
  computedDataGroupHashes: DataGroupHash[];
  icaoPkdAnchors: CscaTrustAnchor[];
  nationalPkdRegistry: NationalPkdRegistry;
  extendedTrustStore: ExtendedTrustStore;
  /** Politique du client KYC : niveaux de confiance acceptés comme "suffisants". */
  clientAcceptedLevels: Array<"high" | "medium" | "low">;
  atIso8601?: string;
}

export interface ChainValidationResult extends TrustChainResult {
  dataGroupHashMismatches: number[];
  /** true si aucune source de confiance n'a de CSCA pour ce pays. */
  noTrustAnchorAvailable: boolean;
}

/**
 * Sélectionne la meilleure ancre de confiance disponible pour le pays, dans l'ordre
 * ICAO PKD > PKD nationale > magasin étendu (voir docs/pki-trust-model.md), puis vérifie
 * la chaîne CSCA -> DSC -> SOD et les hashs de DG.
 *
 * La vérification cryptographique de signature (DSC signé par CSCA, SOD signé par DSC)
 * est déléguée à une implémentation concrète (lib ASN.1/crypto) — voir docs/roadmap.md Phase 1.
 * Cette fonction orchestre la sélection de confiance et la synthèse du résultat, qui est
 * la partie spécifique à ce projet (le reste est de la crypto X.509 standard).
 */
export async function validateTrustChain(input: ChainValidationInput): Promise<ChainValidationResult> {
  const atIso8601 = input.atIso8601 ?? new Date().toISOString();

  const icaoAnchors = input.icaoPkdAnchors.filter(
    (a) => a.countryCode === input.countryCode && isCscaValidAt(a, atIso8601),
  );
  const nationalAdapter = input.nationalPkdRegistry.get(input.countryCode);
  const nationalAnchors = nationalAdapter ? await nationalAdapter.fetchCsca() : [];
  const extendedAnchors = input.extendedTrustStore.findByCountry(input.countryCode, atIso8601);

  const candidate =
    icaoAnchors[0] ?? nationalAnchors.find((a) => isCscaValidAt(a, atIso8601)) ?? extendedAnchors[0];

  const hashVerifications = verifyDataGroupHashes(input.sod, input.computedDataGroupHashes);
  const dataGroupHashMismatches = hashVerifications.filter((h) => !h.matches).map((h) => h.dataGroupNumber);

  if (!candidate) {
    return {
      source: "extended-trust-store",
      level: "low",
      sufficientForClientPolicy: false,
      revocationChecked: false,
      revoked: false,
      dataGroupHashMismatches,
      noTrustAnchorAvailable: true,
    };
  }

  // La vérification effective de signature (DSC<-CSCA, SOD<-DSC) et de révocation est
  // déléguée à l'implémentation crypto (voir docs/roadmap.md Phase 1) ; ce stub ne fait
  // que sélectionner l'ancre et assembler le résultat exposé à l'API.
  return {
    source: candidate.source,
    level: candidate.level,
    sufficientForClientPolicy: input.clientAcceptedLevels.includes(candidate.level),
    cscaSubject: candidate.subject,
    dscSubject: input.sod.signerCertificate.subject,
    revocationChecked: false,
    revoked: false,
    dataGroupHashMismatches,
    noTrustAnchorAvailable: false,
  };
}
