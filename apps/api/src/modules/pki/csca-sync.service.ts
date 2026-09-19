import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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
  masterListCertificatesToTrustAnchors,
  createHttpsMasterListSource,
  createLdapMasterListSource,
  type MasterListSource,
} from "@emrtd-verify/pki-trust";
import { PrismaService } from "../prisma/prisma.service";
import { retryWithBackoff } from "../../common/resilience/retry";

const DEFAULT_RETAIN_BATCHES = 2;

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
