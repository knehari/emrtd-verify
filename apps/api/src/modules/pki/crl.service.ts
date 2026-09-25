import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { toAlpha2CountryCode } from "@emrtd-verify/emrtd-core";
import { crlCandidateUrls, verifyRevocationList, type CscaTrustAnchor, type VerifiedRevocationList } from "@emrtd-verify/pki-trust";

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

interface CachedLists {
  lists: VerifiedRevocationList[];
  fetchedAt: number;
}

/** Nouvel essai après un échec de téléchargement (réseau, pays sans CRL publiée) : pas à chaque vérification. */
const RETRY_AFTER_FAILURE_MS = 15 * 60_000;

/**
 * Listes de révocation (CRL) des CSCA pour la validation serveur (Doc 9303 Part 12 §7.1.4) — même
 * démarche que l'app (apps/mobile/src/pki/crlCache.ts) : miroir HTTPS de l'ICAO PKD puis adresses
 * publiées par les CSCA du pays (+ PKD_CRL_HTTPS_URL_TEMPLATE si configuré), chaque CRL n'étant
 * retenue que si sa signature est vérifiée contre un CSCA de confiance du pays. Mise en cache en
 * mémoire jusqu'à sa date de prochaine publication (nextUpdate) ; sans CRL à jour, la chaîne reste
 * « révocation non vérifiée » plutôt que « non révoqué ». CRL_AUTO_FETCH=false désactive le
 * téléchargement (serveur sans accès sortant).
 */
@Injectable()
export class CrlService {
  private readonly logger = new Logger(CrlService.name);
  private readonly cache = new Map<string, CachedLists>();
  private fetchImpl: FetchLike = (url, init) => fetch(url, init);

  constructor(private readonly config: ConfigService) {}

  /** Tests : remplace l'accès réseau. */
  useFetch(fetchImpl: FetchLike): void {
    this.fetchImpl = fetchImpl;
  }

  async revocationListsFor(countryCode: string, anchors: CscaTrustAnchor[], now: Date = new Date()): Promise<VerifiedRevocationList[]> {
    if (anchors.length === 0 || this.config.get<string>("CRL_AUTO_FETCH") === "false") return [];
    const key = toAlpha2CountryCode(countryCode) ?? countryCode.toUpperCase();
    const cached = this.cache.get(key);
    if (cached && this.stillUsable(cached, now)) return cached.lists;

    const lists = await this.download(key, anchors, now);
    // Une CRL déjà vérifiée reste utile (marquée périmée) si le nouveau téléchargement échoue.
    const kept = lists.length > 0 ? lists : (cached?.lists ?? []);
    this.cache.set(key, { lists: kept, fetchedAt: now.getTime() });
    return kept;
  }

  private stillUsable(cached: CachedLists, now: Date): boolean {
    if (cached.lists.length === 0) return now.getTime() - cached.fetchedAt < RETRY_AFTER_FAILURE_MS;
    return cached.lists.every((list) => !list.nextUpdate || list.nextUpdate > now.toISOString());
  }

  private async download(countryKey: string, anchors: CscaTrustAnchor[], now: Date): Promise<VerifiedRevocationList[]> {
    const template = this.config.get<string>("PKD_CRL_HTTPS_URL_TEMPLATE");
    const extra = template ? [template.replace("{countryCode}", countryKey)] : [];
    const trusted = anchors.map((a) => a.certificateDer);
    const nowIso = now.toISOString();
    const verified: VerifiedRevocationList[] = [];
    const failures: string[] = [];

    await Promise.all(
      crlCandidateUrls(countryKey, anchors, extra).map(async (url) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
          const response = await this.fetchImpl(url, { signal: controller.signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const list = await verifyRevocationList(new Uint8Array(await response.arrayBuffer()), trusted, nowIso);
          if (!list) throw new Error("signature ou émetteur non reconnu");
          verified.push(list);
        } catch (error) {
          failures.push(`${url} : ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          clearTimeout(timer);
        }
      }),
    );

    // Par émetteur, la plus récente seulement.
    const newest = new Map<string, VerifiedRevocationList>();
    for (const list of verified) {
      const current = newest.get(list.signerSubject);
      if (!current || list.thisUpdate > current.thisUpdate) newest.set(list.signerSubject, list);
    }
    if (newest.size === 0) {
      this.logger.warn(`Aucune CRL vérifiable pour ${countryKey} : ${failures.join(" | ") || "aucune adresse connue"}`);
    }
    return [...newest.values()];
  }
}
