import * as FileSystem from "expo-file-system";
import { base64ToBytes, bytesToBase64, toAlpha2CountryCode } from "@emrtd-verify/emrtd-core";
import { crlCandidateUrls as sharedCrlCandidateUrls, verifyRevocationList, type CscaTrustAnchor, type VerifiedRevocationList } from "@emrtd-verify/pki-trust";
import defaultCrlsJson from "./defaultCrls.json";

/**
 * Listes de révocation (CRL) des CSCA pour la vérification sur l'appareil (Doc 9303 Part 12 §7.1.4) :
 * - embarquées à la compilation (defaultCrls.json, générées par
 *   apps/api/scripts/build-mobile-default-csca-bundle.ts à partir de CRL fournies par l'opérateur) ;
 * - téléchargées au moment d'une vérification, depuis le miroir HTTPS de l'ICAO PKD puis les
 *   adresses publiées par les CSCA du pays (extension CRLDistributionPoints), et gardées en cache
 *   pour les vérifications hors ligne suivantes.
 * Une CRL n'est JAMAIS utilisée sans que sa signature ait été vérifiée contre un CSCA de confiance
 * du pays (`verifyRevocationList`, à chaque lecture — cache compris) : une CRL forgée pourrait sinon
 * « dé-révoquer » un DSC.
 */

interface StoredCrl {
  countryCode: string;
  derBase64: string;
  url?: string;
  fetchedAt: string;
}

const CACHE_FILE = "crl-cache.json";
const MAX_PER_COUNTRY = 4;
const defaultCrls = defaultCrlsJson as Array<{ countryCode: string; derBase64: string }>;

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

function cacheUri(): string | undefined {
  return FileSystem.documentDirectory ? FileSystem.documentDirectory + CACHE_FILE : undefined;
}

async function readCache(): Promise<StoredCrl[]> {
  const uri = cacheUri();
  if (!uri) return [];
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return [];
    return JSON.parse(await FileSystem.readAsStringAsync(uri)) as StoredCrl[];
  } catch {
    return []; // Cache illisible : repartir de zéro plutôt que bloquer la vérification.
  }
}

async function writeCache(entries: StoredCrl[]): Promise<void> {
  const uri = cacheUri();
  if (uri) await FileSystem.writeAsStringAsync(uri, JSON.stringify(entries));
}

function countryKey(code: string): string {
  return toAlpha2CountryCode(code) ?? code.toUpperCase();
}

/** Garde, par émetteur, la CRL la plus récente. */
function newestPerSigner(lists: VerifiedRevocationList[]): VerifiedRevocationList[] {
  const bySigner = new Map<string, VerifiedRevocationList>();
  for (const list of lists) {
    const current = bySigner.get(list.signerSubject);
    if (!current || list.thisUpdate > current.thisUpdate) bySigner.set(list.signerSubject, list);
  }
  return [...bySigner.values()];
}

/** CRL vérifiées disponibles sur l'appareil pour ce pays (embarquées + cache), sans réseau. */
export async function revocationListsFor(countryCode: string, anchors: CscaTrustAnchor[], atIso8601?: string): Promise<VerifiedRevocationList[]> {
  const key = countryKey(countryCode);
  const ders = [
    ...defaultCrls.filter((c) => countryKey(c.countryCode) === key).map((c) => c.derBase64),
    ...(await readCache()).filter((c) => c.countryCode === key).map((c) => c.derBase64),
  ];
  const trusted = anchors.map((a) => a.certificateDer);
  const verified: VerifiedRevocationList[] = [];
  for (const der of new Set(ders)) {
    const list = await verifyRevocationList(base64ToBytes(der), trusted, atIso8601);
    if (list) verified.push(list);
  }
  return newestPerSigner(verified);
}

/** Adresses à essayer : miroir HTTPS de l'ICAO PKD d'abord, puis celles des CSCA (HTTPS avant HTTP). */
export function crlCandidateUrls(countryCode: string, anchors: CscaTrustAnchor[]): string[] {
  return sharedCrlCandidateUrls(countryKey(countryCode), anchors);
}

export interface RefreshResult {
  /** CRL valides nouvellement mises en cache. */
  added: number;
  /** Adresses essayées sans succès, avec la raison (réseau, HTTP, signature). */
  failures: string[];
  /** Rien n'a été tenté : une CRL encore à jour était déjà disponible. */
  skipped: boolean;
}

/**
 * Télécharge les CRL du pays si aucune CRL à jour (nextUpdate non dépassée) n'est disponible,
 * vérifie chacune contre les CSCA du pays et met en cache celles qui sont valides. Ne lève pas :
 * sans réseau, la vérification continue avec ce qui est déjà sur l'appareil.
 */
export async function refreshRevocationLists(
  countryCode: string,
  anchors: CscaTrustAnchor[],
  options: { timeoutMs?: number; force?: boolean; fetchImpl?: FetchLike } = {},
): Promise<RefreshResult> {
  const now = new Date().toISOString();
  const existing = await revocationListsFor(countryCode, anchors, now);
  if (!options.force && existing.length > 0 && existing.every((list) => !list.stale)) {
    return { added: 0, failures: [], skipped: true };
  }
  const fetchImpl: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const trusted = anchors.map((a) => a.certificateDer);
  const failures: string[] = [];
  const fetched: StoredCrl[] = [];

  await Promise.all(
    crlCandidateUrls(countryCode, anchors).map(async (url) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
      try {
        const response = await fetchImpl(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const der = new Uint8Array(await response.arrayBuffer());
        if (!(await verifyRevocationList(der, trusted, now))) throw new Error("signature ou émetteur non reconnu");
        fetched.push({ countryCode: countryKey(countryCode), derBase64: bytesToBase64(der), url, fetchedAt: now });
      } catch (error) {
        failures.push(`${url} : ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  if (fetched.length > 0) {
    const key = countryKey(countryCode);
    const cache = await readCache();
    const known = new Set(cache.map((c) => c.derBase64));
    const others = cache.filter((c) => c.countryCode !== key);
    const mine = [...fetched.filter((c) => !known.has(c.derBase64)), ...cache.filter((c) => c.countryCode === key)]
      .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))
      .slice(0, MAX_PER_COUNTRY);
    await writeCache([...others, ...mine]);
  }
  return { added: fetched.length, failures, skipped: false };
}

/** Résumé pour les Réglages : pays couverts par au moins une CRL (embarquée ou en cache). */
export async function revocationCacheSummary(): Promise<{ countries: number; lists: number; lastFetchedAt?: string }> {
  const cache = await readCache();
  const countries = new Set([...defaultCrls.map((c) => countryKey(c.countryCode)), ...cache.map((c) => c.countryCode)]);
  const lastFetchedAt = cache.map((c) => c.fetchedAt).sort().pop();
  return { countries: countries.size, lists: defaultCrls.length + cache.length, lastFetchedAt };
}
