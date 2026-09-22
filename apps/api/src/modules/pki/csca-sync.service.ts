import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { CscaCertificateTrustState } from "@prisma/client";
import { readFileSync } from "node:fs";
import {
  parseCertificate,
  certificateCountryCode,
  certificateSerialNumberHex,
  certificateValidityIso,
  distinguishedNameToString,
} from "@emrtd-verify/emrtd-core";
import {
  decodeMasterList,
  verifyMasterListTrust,
  verifyCountryMasterListTrust,
  masterListCertificatesToTrustAnchors,
  type PkdLdifMasterListEntry,
} from "@emrtd-verify/pki-trust";
// Import profond délibéré : `createHttpsMasterListSource`/`createLdapMasterListSource` (et le type
// `MasterListSource` qu'elles retournent) dépendent de `ldapjs` (Node uniquement) et ont été
// retirés du point d'entrée portable du package pour que apps/mobile puisse importer
// `@emrtd-verify/pki-trust` sans casser le bundling Metro — voir packages/pki-trust/src/index.ts
// et docs/pki-trust-model.md "Vérification hors ligne".
import {
  createHttpsMasterListSource,
  createLdapMasterListSource,
  type MasterListSource,
} from "@emrtd-verify/pki-trust/src/pkdClient";
import { PrismaService } from "../prisma/prisma.service";
import { retryWithBackoff } from "../../common/resilience/retry";

const DEFAULT_RETAIN_BATCHES = 2;

interface CscaCertificateInput {
  countryCode: string;
  subject: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  certificateDer: Uint8Array;
  trustState: CscaCertificateTrustState;
  sourceKind: string;
  validatedVia?: string | null;
}

/**
 * Synchronise la CSCA Master List ICAO PKD : récupère les octets bruts (HTTPS ou LDAP, source
 * configurable), les décode et vérifie leur authenticité contre les ancres épinglées
 * (packages/pki-trust/src/masterList.ts — jamais d'auto-bootstrap de confiance), puis persiste
 * les CSCA extraits dans un nouveau lot immutable et bascule le pointeur "lot actif" une fois
 * l'opération intégralement réussie.
 *
 * Fiabilité — c'est la propriété la plus importante de ce service : à AUCUN moment un échec de
 * synchronisation (réseau, signature invalide, panne DB à mi-chemin) ne doit dégrader le magasin
 * de confiance actuel. Le pointeur `CscaTrustState.activeBatchId` n'est mis à jour qu'après le
 * succès complet de l'insertion du nouveau lot ; en cas d'échec à n'importe quelle étape, le lot
 * précédent reste actif et servi tel quel (voir docs/pki-trust-model.md "Fiabilité").
 */
@Injectable()
export class CscaSyncService {
  private readonly logger = new Logger(CscaSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async sync(): Promise<{ status: "success" | "failed"; certificateCount?: number; errorMessage?: string }> {
    const run = await this.prisma.masterListSyncRun.create({
      data: { status: "success", source: this.resolveSourceKind() },
    });

    try {
      const source = this.buildSource();
      const sourceKind = this.resolveSourceKind();

      // Backoff : une panne réseau transitoire (PKD momentanément indisponible) ne doit pas
      // faire échouer toute la synchronisation du jour — voir common/resilience/retry.ts.
      const masterListDer = await retryWithBackoff(() => source.fetchMasterList(), {
        maxAttempts: 3,
        baseDelayMs: 1000,
      });

      const decoded = decodeMasterList(masterListDer);
      const trustAnchors = this.loadSignerTrustAnchors();
      const trust = await verifyMasterListTrust(decoded, trustAnchors);
      if (!trust.trusted) {
        throw new Error(`Master List non fiable : ${trust.reason}`);
      }

      const anchors = masterListCertificatesToTrustAnchors(decoded.content.certificatesDer, (der) => {
        const cert = parseCertificate(der);
        const { notBefore, notAfter } = certificateValidityIso(cert);
        return {
          subject: distinguishedNameToString(cert.subject),
          countryCode: certificateCountryCode(cert),
          serialNumber: certificateSerialNumberHex(cert),
          notBefore,
          notAfter,
        };
      });

      if (anchors.length === 0) {
        // Une Master List authentique mais vide (ou dont aucun certificat n'a de code pays
        // exploitable) est suspecte en soi — refuser plutôt que de vider silencieusement le
        // magasin de confiance à la prochaine bascule.
        throw new Error("Master List vérifiée mais aucun CSCA exploitable n'en a été extrait");
      }

      await this.persistAndSwap(anchors, sourceKind, decoded.signerCertificate.subject);
      await this.retainRecentBatches(this.resolveRetainBatches());

      await this.prisma.masterListSyncRun.update({
        where: { id: run.id },
        data: { status: "success", finishedAt: new Date(), certificateCount: anchors.length },
      });

      this.logger.log(`Synchronisation Master List réussie : ${anchors.length} CSCA importés (source=${sourceKind})`);
      return { status: "success", certificateCount: anchors.length };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.prisma.masterListSyncRun.update({
        where: { id: run.id },
        data: { status: "failed", finishedAt: new Date(), errorMessage },
      });
      // Ne jamais laisser une synchronisation en échec planter le processus API (schedulé ou
      // déclenché manuellement) — le magasin de confiance précédent reste actif et servi.
      this.logger.error(`Synchronisation Master List échouée, magasin de confiance précédent conservé : ${errorMessage}`);
      return { status: "failed", errorMessage };
    }
  }

  /**
   * Phase B du modèle de confiance à deux niveaux (voir docs/pki-trust-model.md) : valide des
   * Master Lists NATIONALES (branche LDAP ICAO PKD `o=ml,c=XX`, un CMS par pays — typiquement
   * obtenues via un export LDIF, voir packages/pki-trust/src/pkdLdif.ts) contre les CSCA DÉJÀ
   * approuvées pour chaque pays. Ne bootstrap JAMAIS la confiance depuis l'entrée elle-même — une
   * Master List nationale dont le pays n'a encore aucune CSCA approuvée (ex. Phase A pas encore
   * exécutée, ou pays absent de la Master List ICAO globale) est ignorée, jamais acceptée à
   * l'aveugle. Bascule atomique comme `sync()` : copie le lot actif, y fusionne les résultats
   * validés, puis bascule le pointeur seulement après succès complet.
   */
  async syncCountryMasterLists(
    entries: PkdLdifMasterListEntry[],
  ): Promise<{ status: "success" | "failed"; validatedCountries?: number; skippedCountries?: number; errorMessage?: string }> {
    const run = await this.prisma.masterListSyncRun.create({ data: { status: "success", source: "ldif-country" } });

    try {
      const anchorsByCountry = await this.loadUsableAnchorsByCountry();
      const newRecords: CscaCertificateInput[] = [];
      let validatedCountries = 0;
      let skippedCountries = 0;

      for (const entry of entries) {
        let decoded;
        try {
          decoded = decodeMasterList(entry.masterListCmsDer);
        } catch (error) {
          this.logger.warn(`Master List nationale ${entry.countryCode} ignorée (décodage impossible) : ${String(error)}`);
          skippedCountries++;
          continue;
        }

        const alreadyTrusted = anchorsByCountry.get(entry.countryCode) ?? [];
        const trust = await verifyCountryMasterListTrust(decoded, alreadyTrusted);
        if (!trust.trusted) {
          this.logger.warn(`Master List nationale ${entry.countryCode} non fiable, ignorée : ${trust.reason}`);
          skippedCountries++;
          continue;
        }
        validatedCountries++;

        for (const certDer of decoded.content.certificatesDer) {
          const cert = parseCertificate(certDer);
          const countryCode = certificateCountryCode(cert);
          // Une Master List nationale peut légitimement embarquer des CSCA d'autres pays (Doc
          // 9303 Part 12 §8 ne le restreint pas) — hors périmètre ici : chaque pays doit être
          // validé via SA PROPRE Master List, pas par ricochet via celle d'un tiers.
          if (countryCode !== entry.countryCode) continue;

          const { notBefore, notAfter } = certificateValidityIso(cert);
          newRecords.push({
            countryCode,
            subject: distinguishedNameToString(cert.subject),
            serialNumber: certificateSerialNumberHex(cert),
            notBefore,
            notAfter,
            certificateDer: certDer,
            trustState: "LINK_VALIDATED",
            sourceKind: "country-ml",
            validatedVia: `country-ml-signer:${decoded.signerCertificate.serialNumber}`,
          });
        }
      }

      if (newRecords.length > 0) {
        await this.persistMergedBatch(newRecords, "ldif-country");
        await this.retainRecentBatches(this.resolveRetainBatches());
      }

      await this.prisma.masterListSyncRun.update({
        where: { id: run.id },
        data: { status: "success", finishedAt: new Date(), certificateCount: newRecords.length },
      });
      this.logger.log(
        `Synchronisation Master Lists nationales (LDIF) : ${validatedCountries} pays validés, ${skippedCountries} ignorés, ${newRecords.length} CSCA ajoutés/mis à jour`,
      );
      return { status: "success", validatedCountries, skippedCountries };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.prisma.masterListSyncRun.update({
        where: { id: run.id },
        data: { status: "failed", finishedAt: new Date(), errorMessage },
      });
      this.logger.error(`Synchronisation Master Lists nationales échouée, magasin de confiance précédent conservé : ${errorMessage}`);
      return { status: "failed", errorMessage };
    }
  }

  /** CSCA du lot actif dont l'état de confiance est utilisable comme base pour valider une Master List nationale. */
  private async loadUsableAnchorsByCountry(): Promise<Map<string, Uint8Array[]>> {
    const state = await this.prisma.cscaTrustState.findUnique({ where: { id: 1 } });
    const byCountry = new Map<string, Uint8Array[]>();
    if (!state?.activeBatchId) {
      return byCountry;
    }

    const records = await this.prisma.cscaCertificateRecord.findMany({
      where: { batchId: state.activeBatchId, trustState: { in: ["ICAO_ML_VALIDATED", "LINK_VALIDATED", "OUT_OF_BAND_VALIDATED"] } },
    });
    for (const record of records) {
      const list = byCountry.get(record.countryCode) ?? [];
      list.push(new Uint8Array(record.certificateDer));
      byCountry.set(record.countryCode, list);
    }
    return byCountry;
  }

  /**
   * Crée un nouveau lot = copie intégrale du lot actif, fusionnée avec `updatedRecords` (par
   * countryCode+serialNumber : une entrée mise à jour remplace l'ancienne), puis bascule le
   * pointeur — préserve la propriété d'immutabilité des lots et l'atomicité de la bascule.
   */
  private async persistMergedBatch(updatedRecords: CscaCertificateInput[], sourceLabel: string): Promise<void> {
    const state = await this.prisma.cscaTrustState.findUnique({ where: { id: 1 } });
    const existingRecords = state?.activeBatchId
      ? await this.prisma.cscaCertificateRecord.findMany({ where: { batchId: state.activeBatchId } })
      : [];

    const merged = new Map<string, CscaCertificateInput>();
    for (const record of existingRecords) {
      merged.set(`${record.countryCode}:${record.serialNumber}`, {
        countryCode: record.countryCode,
        subject: record.subject,
        serialNumber: record.serialNumber,
        notBefore: record.notBefore.toISOString(),
        notAfter: record.notAfter.toISOString(),
        certificateDer: new Uint8Array(record.certificateDer),
        trustState: record.trustState,
        sourceKind: record.sourceKind,
        validatedVia: record.validatedVia,
      });
    }
    for (const record of updatedRecords) {
      merged.set(`${record.countryCode}:${record.serialNumber}`, record);
    }
    const finalRecords = Array.from(merged.values());

    const existingBatch = state?.activeBatchId ? await this.prisma.cscaSyncBatch.findUnique({ where: { id: state.activeBatchId } }) : null;

    await this.prisma.$transaction(async (tx) => {
      const batch = await tx.cscaSyncBatch.create({
        data: {
          source: sourceLabel,
          masterListSignerSubject: existingBatch?.masterListSignerSubject ?? "(aucune Master List ICAO globale synchronisée)",
          certificateCount: finalRecords.length,
        },
      });

      await tx.cscaCertificateRecord.createMany({
        data: finalRecords.map((record) => ({
          batchId: batch.id,
          countryCode: record.countryCode,
          subject: record.subject,
          serialNumber: record.serialNumber,
          notBefore: new Date(record.notBefore),
          notAfter: new Date(record.notAfter),
          certificateDer: Buffer.from(record.certificateDer),
          trustState: record.trustState,
          sourceKind: record.sourceKind,
          validatedVia: record.validatedVia,
        })),
      });

      await tx.cscaTrustState.upsert({
        where: { id: 1 },
        create: { id: 1, activeBatchId: batch.id },
        update: { activeBatchId: batch.id },
      });
    });
  }

  private async persistAndSwap(
    anchors: Array<{
      countryCode: string;
      certificateDer: Uint8Array;
      subject: string;
      serialNumber: string;
      notBefore: string;
      notAfter: string;
    }>,
    source: string,
    masterListSignerSubject: string,
  ): Promise<void> {
    // Transaction interactive : la création du lot + ses certificats + la bascule du pointeur
    // actif sont atomiques — soit tout est visible pour les lecteurs, soit rien ne l'est.
    await this.prisma.$transaction(async (tx) => {
      const batch = await tx.cscaSyncBatch.create({
        data: { source, masterListSignerSubject, certificateCount: anchors.length },
      });

      await tx.cscaCertificateRecord.createMany({
        data: anchors.map((anchor) => ({
          batchId: batch.id,
          countryCode: anchor.countryCode,
          subject: anchor.subject,
          serialNumber: anchor.serialNumber,
          notBefore: new Date(anchor.notBefore),
          notAfter: new Date(anchor.notAfter),
          certificateDer: Buffer.from(anchor.certificateDer),
          // Extrait de la Master List ICAO globale, dont le signataire a été vérifié contre une
          // ancre épinglée hors bande — niveau de confiance le plus fort obtenu automatiquement
          // (voir docs/pki-trust-model.md "Modèle de confiance à deux niveaux").
          trustState: "ICAO_ML_VALIDATED" as const,
          sourceKind: "icao-global-ml",
          validatedVia: "pinned-icao-master-list-signer-anchor",
        })),
      });

      await tx.cscaTrustState.upsert({
        where: { id: 1 },
        create: { id: 1, activeBatchId: batch.id },
        update: { activeBatchId: batch.id },
      });
    });
  }

  /** Ne conserve que les N derniers lots (le lot actif + un historique court pour audit/rollback manuel). */
  private async retainRecentBatches(retain: number): Promise<void> {
    const recentBatches = await this.prisma.cscaSyncBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: retain,
      select: { id: true },
    });
    const keepIds = recentBatches.map((b) => b.id);
    await this.prisma.cscaSyncBatch.deleteMany({ where: { id: { notIn: keepIds } } });
  }

  private resolveSourceKind(): "https" | "ldap" {
    return this.config.get<string>("PKD_MASTER_LIST_SOURCE") === "ldap" ? "ldap" : "https";
  }

  private buildSource(): MasterListSource {
    if (this.resolveSourceKind() === "ldap") {
      const masterListAttribute = this.config.get<string>("PKD_LDAP_MASTER_LIST_ATTRIBUTE") ?? "CscaMasterListData";
      return createLdapMasterListSource({
        url: this.config.get<string>("ICAO_PKD_LDAP_URL") ?? "",
        bindDn: this.config.get<string>("ICAO_PKD_LDAP_BIND_DN"),
        bindPassword: this.config.get<string>("ICAO_PKD_LDAP_BIND_PASSWORD"),
        masterList: {
          baseDn: this.config.get<string>("PKD_LDAP_MASTER_LIST_BASE_DN") ?? "",
          filter: this.config.get<string>("PKD_LDAP_MASTER_LIST_FILTER") ?? "(objectClass=*)",
          attribute: masterListAttribute,
        },
        revocationList: this.config.get<string>("PKD_LDAP_CRL_BASE_DN")
          ? {
              baseDn: this.config.get<string>("PKD_LDAP_CRL_BASE_DN")!,
              filter: this.config.get<string>("PKD_LDAP_CRL_FILTER") ?? "(c={countryCode})",
              attribute: this.config.get<string>("PKD_LDAP_CRL_ATTRIBUTE") ?? "certificateRevocationList;binary",
            }
          : undefined,
      });
    }

    return createHttpsMasterListSource({
      masterListUrl: this.config.get<string>("PKD_MASTER_LIST_HTTPS_URL") ?? "",
      crlUrlTemplate: this.config.get<string>("PKD_CRL_HTTPS_URL_TEMPLATE"),
    });
  }

  private loadSignerTrustAnchors(): Uint8Array[] {
    const path = this.config.get<string>("MASTER_LIST_SIGNER_TRUST_ANCHORS_PATH");
    if (!path) {
      return [];
    }
    try {
      const raw = readFileSync(path, "utf-8");
      const entries = JSON.parse(raw) as Array<{ certificateDer: string }>;
      return entries.map((entry) => new Uint8Array(Buffer.from(entry.certificateDer, "base64")));
    } catch (error) {
      this.logger.warn(`Ancres de confiance Master List Signer introuvables ou invalides (${path}) : ${String(error)}`);
      return [];
    }
  }

  private resolveRetainBatches(): number {
    const raw = this.config.get<string>("CSCA_SYNC_RETAIN_BATCHES");
    const parsed = raw ? Number(raw) : DEFAULT_RETAIN_BATCHES;
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_RETAIN_BATCHES;
  }
}
