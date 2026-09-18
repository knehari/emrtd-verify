import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConfigService } from "@nestjs/config";
import type { CscaTrustAnchor } from "@emrtd-verify/pki-trust";
import { TrustCacheService } from "../../src/modules/pki/trust-cache.service";

function makeAnchor(countryCode: string): CscaTrustAnchor {
  return {
    countryCode,
    certificateDer: new Uint8Array([1, 2, 3]),
    subject: `CN=CSCA ${countryCode}`,
    serialNumber: "01",
    notBefore: "2020-01-01T00:00:00.000Z",
    notAfter: "2030-01-01T00:00:00.000Z",
    source: "icao-pkd",
    level: "high",
  };
}

function configWithTtl(ttlMs?: number): ConfigService {
  return { get: (key: string) => (key === "TRUST_CACHE_TTL_MS" && ttlMs !== undefined ? String(ttlMs) : undefined) } as ConfigService;
}

describe("TrustCacheService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retourne undefined pour un pays jamais mis en cache", () => {
    const cache = new TrustCacheService(configWithTtl());
    expect(cache.get("FRA")).toBeUndefined();
  });

  it("retourne les ancres mises en cache tant que le TTL n'est pas écoulé", () => {
    const cache = new TrustCacheService(configWithTtl(1000));
    const anchors = [makeAnchor("FRA")];
    cache.set("FRA", anchors, 0);

    expect(cache.get("FRA", 500)).toEqual(anchors);
    expect(cache.get("FRA", 999)).toEqual(anchors);
  });

  it("expire une entrée une fois le TTL écoulé et l'évince du cache", () => {
    const cache = new TrustCacheService(configWithTtl(1000));
    cache.set("FRA", [makeAnchor("FRA")], 0);

    expect(cache.get("FRA", 1000)).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it("utilise le TTL par défaut (1h) quand TRUST_CACHE_TTL_MS n'est pas configuré", () => {
    const cache = new TrustCacheService(configWithTtl());
    cache.set("BEL", [makeAnchor("BEL")], 0);

    expect(cache.get("BEL", 59 * 60 * 1000)).toBeDefined();
    expect(cache.get("BEL", 61 * 60 * 1000)).toBeUndefined();
  });

  it("isole le cache par pays", () => {
    const cache = new TrustCacheService(configWithTtl(1000));
    cache.set("FRA", [makeAnchor("FRA")], 0);
    expect(cache.get("BEL", 0)).toBeUndefined();
    expect(cache.get("FRA", 0)).toBeDefined();
  });

  it("invalidate() supprime une entrée avant l'expiration naturelle", () => {
    const cache = new TrustCacheService(configWithTtl(10_000));
    cache.set("FRA", [makeAnchor("FRA")], 0);
    cache.invalidate("FRA");
    expect(cache.get("FRA", 1)).toBeUndefined();
  });
});
