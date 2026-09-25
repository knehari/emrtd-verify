import { Injectable } from "@nestjs/common";
import type { CscaTrustAnchor } from "@emrtd-verify/pki-trust";
import { toAlpha2CountryCode, toAlpha3CountryCode } from "@emrtd-verify/emrtd-core";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Lecture du magasin CSCA synchronisé (voir CscaSyncService) — chemin de lecture pur, jamais de
 * réseau ni de décodage cryptographique ici, pour rester rapide sur le chemin d'une vérification
 * (voir docs/pki-trust-model.md "Rapidité"). Ne lit toujours que le lot actif
 * (CscaTrustState.activeBatchId) : un lot en cours de synchronisation ou abandonné n'est jamais
 * visible avant sa bascule complète.
 */
@Injectable()
export class CscaStoreService {
  constructor(private readonly prisma: PrismaService) {}

  async getAnchorsForCountry(countryCode: string): Promise<CscaTrustAnchor[]> {
    const activeBatchId = await this.getActiveBatchId();
    if (!activeBatchId) {
      return [];
    }

    const records = await this.prisma.cscaCertificateRecord.findMany({
      where: {
        batchId: activeBatchId,
        // Les CSCA sont enregistrés avec le pays de leur certificat (X.509 C=, 2 lettres : « FR »),
        // la demande arrive avec celui de la MRZ (3 lettres : « FRA ») — les deux formes sont cherchées.
        countryCode: { in: countryCodeVariants(countryCode) },
        // Seuls ces états de confiance sont utilisables comme ancre — DISCOVERED/PKD_OBSERVED/
        // QUARANTINED/REVOKED_OR_DISTRUSTED ne sont jamais servis à la chaîne de validation, voir
        // docs/pki-trust-model.md "Modèle de confiance à deux niveaux".
        trustState: { in: ["ICAO_ML_VALIDATED", "LINK_VALIDATED", "OUT_OF_BAND_VALIDATED"] },
      },
    });

    return records.map(toTrustAnchor);
  }

  /**
   * Toutes les ancres CSCA du lot actif, tous pays confondus — utilisé pour construire le bundle
   * hors ligne distribué au mobile (voir CscaBundleSignerService/PkiTrustController), jamais par
   * le chemin de validation d'une chaîne (qui reste filtré par pays via `getAnchorsForCountry`).
   */
  async getAllAnchors(): Promise<CscaTrustAnchor[]> {
    const activeBatchId = await this.getActiveBatchId();
    if (!activeBatchId) {
      return [];
    }

    const records = await this.prisma.cscaCertificateRecord.findMany({
      where: {
        batchId: activeBatchId,
        trustState: { in: ["ICAO_ML_VALIDATED", "LINK_VALIDATED", "OUT_OF_BAND_VALIDATED"] },
      },
    });

    return records.map(toTrustAnchor);
  }

  /** Identifiant du lot actif, ou `undefined` si aucune synchronisation n'a encore réussi. */
  async getActiveBatchId(): Promise<string | undefined> {
    const state = await this.prisma.cscaTrustState.findUnique({ where: { id: 1 } });
    return state?.activeBatchId ?? undefined;
  }
}

function toTrustAnchor(record: {
  countryCode: string;
  certificateDer: Uint8Array | Buffer;
  subject: string;
  serialNumber: string;
  notBefore: Date;
  notAfter: Date;
}): CscaTrustAnchor {
  return {
    countryCode: record.countryCode,
    certificateDer: new Uint8Array(record.certificateDer),
    subject: record.subject,
    serialNumber: record.serialNumber,
    notBefore: record.notBefore.toISOString(),
    notAfter: record.notAfter.toISOString(),
    source: "icao-pkd" as const,
    level: "high" as const,
  };
}

/** « FRA », « FR » ou « fr » → [« FRA », « FR »] ; un code sans équivalent (UTO…) reste seul. */
export function countryCodeVariants(countryCode: string): string[] {
  const normalized = countryCode.replace(/</g, "").trim().toUpperCase();
  const alpha2 = toAlpha2CountryCode(normalized);
  const alpha3 = alpha2 ? toAlpha3CountryCode(alpha2) : undefined;
  return [...new Set([normalized, alpha2, alpha3].filter((code): code is string => Boolean(code)))];
}
