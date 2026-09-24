import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildSignedCrl,
  cscaToTrustAnchor,
  generateCertificate,
  generateCscaAndDsc,
} from "../../../../packages/pki-trust/test/support/pkiFixtures";

const files = new Map<string, string>();
vi.mock("expo-file-system", () => ({
  documentDirectory: "file:///mock-documents/",
  getInfoAsync: vi.fn(async (uri: string) => ({ exists: files.has(uri) })),
  writeAsStringAsync: vi.fn(async (uri: string, contents: string) => {
    files.set(uri, contents);
  }),
  readAsStringAsync: vi.fn(async (uri: string) => {
    const content = files.get(uri);
    if (content === undefined) throw new Error("fichier introuvable");
    return content;
  }),
}));

const { crlCandidateUrls, refreshRevocationLists, revocationListsFor, revocationCacheSummary } = await import("../../src/pki/crlCache");

function serving(routes: Record<string, Uint8Array>) {
  const calls: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(url);
    const body = routes[url];
    return { ok: body !== undefined, status: body ? 200 : 404, arrayBuffer: async () => (body ?? new Uint8Array(0)).slice().buffer };
  };
  return { fetchImpl, calls };
}

describe("crlCache", () => {
  beforeEach(() => files.clear());

  it("essaie d'abord le miroir HTTPS de l'ICAO (code alpha-3), puis les adresses des CSCA, HTTPS avant HTTP", async () => {
    const csca = await generateCertificate({
      commonName: "CSCA FR",
      countryCode: "FR",
      isCa: true,
      crlDistributionPoints: ["http://ants.example/csca_crl", "https://ants.example/csca.crl"],
    });
    expect(crlCandidateUrls("FRA", [cscaToTrustAnchor("FR", csca)])).toEqual([
      "https://pkddownload1.icao.int/CRLs/FRA.crl",
      "https://pkddownload2.icao.int/CRLs/FRA.crl",
      "https://ants.example/csca.crl",
      "http://ants.example/csca_crl",
    ]);
  });

  it("télécharge, vérifie et met en cache la CRL, puis s'en sert hors ligne sans retélécharger", async () => {
    const { csca, dsc } = await generateCscaAndDsc("FR");
    const anchors = [cscaToTrustAnchor("FR", csca)];
    const crl = await buildSignedCrl({ issuer: csca, revoked: [dsc.certificate] });
    const { fetchImpl, calls } = serving({ "https://pkddownload1.icao.int/CRLs/FRA.crl": crl });

    const first = await refreshRevocationLists("FRA", anchors, { fetchImpl });
    expect(first).toMatchObject({ added: 1, skipped: false });
    const lists = await revocationListsFor("FRA", anchors);
    expect(lists).toHaveLength(1);
    expect(lists[0].revokedSerialNumbersHex).toHaveLength(1);

    const second = await refreshRevocationLists("FR", anchors, { fetchImpl });
    expect(second.skipped).toBe(true);
    expect(calls.filter((u) => u.includes("pkddownload1"))).toHaveLength(1);
    expect((await revocationCacheSummary()).countries).toBe(1);
  });

  it("refuse une CRL au nom du CSCA mais signée par une autre clé", async () => {
    const { csca } = await generateCscaAndDsc("FR");
    const { csca: forger } = await generateCscaAndDsc("FR");
    const forged = await buildSignedCrl({ issuer: forger, revoked: [] });
    const { fetchImpl } = serving({ "https://pkddownload1.icao.int/CRLs/FRA.crl": forged });
    const result = await refreshRevocationLists("FRA", [cscaToTrustAnchor("FR", csca)], { fetchImpl });
    expect(result.added).toBe(0);
    expect(result.failures.join(" ")).toContain("signature ou émetteur non reconnu");
    expect(await revocationListsFor("FRA", [cscaToTrustAnchor("FR", csca)])).toHaveLength(0);
  });
});
