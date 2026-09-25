import { describe, it, expect, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import { CrlService } from "../../src/modules/pki/crl.service";
// Fixtures réservées aux tests (CSCA/DSC et CRL réellement signés), partagées avec packages/pki-trust.
import { buildSignedCrl, cscaToTrustAnchor, generateCscaAndDsc } from "../../../../packages/pki-trust/test/support/pkiFixtures";

function config(values: Record<string, string> = {}) {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function response(body: Uint8Array | null, status = 200) {
  return { ok: status === 200, status, arrayBuffer: async () => (body ?? new Uint8Array()).slice().buffer };
}

const ICAO_FRA = "https://pkddownload1.icao.int/CRLs/FRA.crl";

describe("CrlService", () => {
  it("télécharge la CRL du pays (miroir ICAO, code MRZ alpha-3), la vérifie et la garde en cache jusqu'à nextUpdate", async () => {
    const { csca } = await generateCscaAndDsc("FR");
    const crl = await buildSignedCrl({ issuer: csca, revoked: [], thisUpdate: new Date("2026-09-01"), nextUpdate: new Date("2026-12-01") });
    const fetchMock = vi.fn(async (url: string) => (url === ICAO_FRA ? response(crl) : response(null, 404)));
    const service = new CrlService(config());
    service.useFetch(fetchMock);

    const lists = await service.revocationListsFor("FRA", [cscaToTrustAnchor("FR", csca)], new Date("2026-09-25"));
    expect(lists).toHaveLength(1);
    expect(lists[0]!.stale).toBe(false);

    const calls = fetchMock.mock.calls.length;
    await service.revocationListsFor("FR", [cscaToTrustAnchor("FR", csca)], new Date("2026-10-01"));
    expect(fetchMock.mock.calls.length).toBe(calls); // en cache (même pays, CRL encore à jour)
  });

  it("refuse une CRL signée par une autre clé, et ne réessaie pas à chaque vérification", async () => {
    const { csca } = await generateCscaAndDsc("FR");
    const { csca: forger } = await generateCscaAndDsc("FR");
    const forged = await buildSignedCrl({ issuer: forger, revoked: [] });
    const fetchMock = vi.fn(async (url: string) => (url === ICAO_FRA ? response(forged) : response(null, 404)));
    const service = new CrlService(config());
    service.useFetch(fetchMock);

    const now = new Date("2026-09-25T10:00:00Z");
    expect(await service.revocationListsFor("FRA", [cscaToTrustAnchor("FR", csca)], now)).toEqual([]);
    const calls = fetchMock.mock.calls.length;
    await service.revocationListsFor("FRA", [cscaToTrustAnchor("FR", csca)], new Date("2026-09-25T10:05:00Z"));
    expect(fetchMock.mock.calls.length).toBe(calls);
    await service.revocationListsFor("FRA", [cscaToTrustAnchor("FR", csca)], new Date("2026-09-25T10:30:00Z"));
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls); // nouvel essai après 15 min
  });

  it("CRL_AUTO_FETCH=false : aucun accès réseau", async () => {
    const { csca } = await generateCscaAndDsc("FR");
    const fetchMock = vi.fn();
    const service = new CrlService(config({ CRL_AUTO_FETCH: "false" }));
    service.useFetch(fetchMock);
    expect(await service.revocationListsFor("FRA", [cscaToTrustAnchor("FR", csca)])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
