import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { CscaTrustAnchor } from "@emrtd-verify/pki-trust";

interface CacheEntry {
  anchors: CscaTrustAnchor[];
  expiresAt: number;
}

/**
 * Cache TTL en mémoire des ancres de confiance CSCA par pays. Évite de retélécharger/redécoder
 * l'ICAO PKD (Master List CMS, potentiellement volumineuse — voir docs/pki-trust-model.md) à
 * chaque vérification : un `Map` en mémoire suffit ici, l'API n'a pas besoin d'un cache partagé
 * entre instances pour cette donnée (elle est publique et identique pour toutes les instances,
 * un cache-miss se contente de retélécharger).
 */
@Injectable()
export class TrustCacheService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(private readonly config: ConfigService) {
    // Défaut 1h : les CSCA Master Lists ICAO PKD ne changent pas plus souvent que quelques
    // fois par mois (voir docs/pki-trust-model.md) ; 1h est déjà largement plus prudent
    // que nécessaire tout en évitant un re-fetch sur chaque vérification.
    const configuredTtl = this.config.get<string>("TRUST_CACHE_TTL_MS");
    this.ttlMs = configuredTtl ? Number(configuredTtl) : 60 * 60 * 1000;
  }

  get(countryCode: string, now: number = Date.now()): CscaTrustAnchor[] | undefined {
    const entry = this.cache.get(countryCode);
    if (!entry) {
      return undefined;
    }
    if (now >= entry.expiresAt) {
      this.cache.delete(countryCode);
      return undefined;
    }
    return entry.anchors;
  }

  set(countryCode: string, anchors: CscaTrustAnchor[], now: number = Date.now()): void {
    this.cache.set(countryCode, { anchors, expiresAt: now + this.ttlMs });
  }

  /** Purge manuelle d'une entrée — utile si une CRL/Master List est mise à jour hors bande. */
  invalidate(countryCode: string): void {
    this.cache.delete(countryCode);
  }

  size(): number {
    return this.cache.size;
  }
}
