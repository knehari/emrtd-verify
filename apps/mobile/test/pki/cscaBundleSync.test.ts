import { describe, it, expect, vi, beforeEach } from "vitest";
import { webcrypto } from "node:crypto";
import { signJsonPayload } from "@emrtd-verify/emrtd-core";
import type { CscaBundle } from "@emrtd-verify/shared-types";

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

// Importé après le mock (vi.mock est hoisté par vitest, donc l'ordre textuel n'a pas d'importance
// en pratique, mais explicite ici pour la lisibilité).
const { syncCscaBundle, readCachedCscaBundle, getLocalCscaAnchors, CscaBundleSyncError } = await import("../../src/pki/cscaBundleSync");
const { appConfig } = await import("../../src/config");
const { default: defaultCscaAnchors } = await import("../../src/pki/defaultCscaBundle.json");

async function generateKeyPairBase64() {
  const keyPair = (await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pkcs8 = Buffer.from(await webcrypto.subtle.exportKey("pkcs8", keyPair.privateKey)).toString("base64");
  const spki = Buffer.from(await webcrypto.subtle.exportKey("spki", keyPair.publicKey)).toString("base64");
  return { keyPair, pkcs8, spki };
}

async function buildSignedBundle(privateKey: CryptoKey): Promise<CscaBundle> {
  const bundleWithoutSignature: Omit<CscaBundle, "signature"> = {
    bundleFormatVersion: 1,
    batchId: "batch-1",
    generatedAt: "2026-01-01T00:00:00.000Z",
    anchors: [
      {
        countryCode: "FRA",
        certificateDerBase64: Buffer.from([0x30, 0x82, 0x01, 0x0a]).toString("base64"),
        subject: "CN=CSCA France",
        serialNumber: "01",
        notBefore: "2020-01-01T00:00:00.000Z",
        notAfter: "2030-01-01T00:00:00.000Z",
        source: "icao-pkd",
        level: "high",
      },
    ],
    algorithm: "ECDSA-P256-SHA256",
  };
  const signature = await signJsonPayload(bundleWithoutSignature, privateKey);
  return { ...bundleWithoutSignature, signature };
}

describe("syncCscaBundle", () => {
  beforeEach(() => {
    files.clear();
    appConfig.apiBaseUrl = "https://api.test.example";
    appConfig.apiKey = "test-key";
    appConfig.cscaBundleSigningPublicKeyBase64 = "";
    vi.unstubAllGlobals();
  });

  it("vérifie la signature, persiste et renvoie le bundle quand elle est valide", async () => {
    const { keyPair, spki } = await generateKeyPairBase64();
    appConfig.cscaBundleSigningPublicKeyBase64 = spki;
    const bundle = await buildSignedBundle(keyPair.privateKey);

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => bundle })));

    const result = await syncCscaBundle();
    expect(result).toEqual(bundle);

    const cached = await readCachedCscaBundle();
    expect(cached).toEqual(bundle);
  });

  it("rejette et ne persiste rien quand la signature est invalide (bundle altéré)", async () => {
    const { keyPair, spki } = await generateKeyPairBase64();
    appConfig.cscaBundleSigningPublicKeyBase64 = spki;
    const bundle = await buildSignedBundle(keyPair.privateKey);
    const tampered: CscaBundle = { ...bundle, batchId: "batch-attacker-controlled" };

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => tampered })));

    await expect(syncCscaBundle()).rejects.toThrow(CscaBundleSyncError);
    await expect(readCachedCscaBundle()).resolves.toBeUndefined();
  });

  it("rejette un bundle sans signature", async () => {
    const { spki } = await generateKeyPairBase64();
    appConfig.cscaBundleSigningPublicKeyBase64 = spki;
    const unsigned = { ...(await buildSignedBundle((await generateKeyPairBase64()).keyPair.privateKey)), signature: "" };

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => unsigned })));

    await expect(syncCscaBundle()).rejects.toThrow(CscaBundleSyncError);
  });

  it("refuse de synchroniser si aucune clé publique n'est configurée côté app", async () => {
    appConfig.cscaBundleSigningPublicKeyBase64 = "";
    const { keyPair } = await generateKeyPairBase64();
    const bundle = await buildSignedBundle(keyPair.privateKey);

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => bundle })));

    await expect(syncCscaBundle()).rejects.toThrow(CscaBundleSyncError);
  });

  it("lève une erreur explicite sur une réponse HTTP non-ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));
    await expect(syncCscaBundle()).rejects.toThrow(CscaBundleSyncError);
  });
});

describe("readCachedCscaBundle / getLocalCscaAnchors", () => {
  beforeEach(() => {
    files.clear();
  });

  it("renvoie undefined mais les ancres embarquées quand rien n'a encore été synchronisé", async () => {
    await expect(readCachedCscaBundle()).resolves.toBeUndefined();
    const anchors = await getLocalCscaAnchors();
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors).toHaveLength(defaultCscaAnchors.length);
  });

  it("décode les ancres en base64 -> Uint8Array, filtrable par pays", async () => {
    const { keyPair, spki } = await generateKeyPairBase64();
    appConfig.cscaBundleSigningPublicKeyBase64 = spki;
    const bundle = await buildSignedBundle(keyPair.privateKey);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => bundle })));
    await syncCscaBundle();

    // Code MRZ "FRA" : l'ancre synchronisée ("FRA") ET les CSCA-FRANCE embarqués (C=FR) répondent.
    const anchors = await getLocalCscaAnchors("FRA");
    const embeddedFrench = defaultCscaAnchors.filter((a) => a.countryCode === "FR").length;
    expect(embeddedFrench).toBeGreaterThan(0);
    expect(anchors).toHaveLength(embeddedFrench + 1);
    const synced = anchors.find((a) => a.countryCode === "FRA");
    expect(Array.from(synced!.certificateDer)).toEqual([0x30, 0x82, 0x01, 0x0a]);
    expect(anchors.filter((a) => a.countryCode === "FR").every((a) => a.subject.includes("CSCA-FRANCE"))).toBe(true);

    await expect(getLocalCscaAnchors("XXX")).resolves.toEqual([]);
  });
});
