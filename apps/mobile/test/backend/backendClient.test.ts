import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { signJsonPayload } from "@emrtd-verify/emrtd-core";
import type { VerificationResult } from "@emrtd-verify/shared-types";

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
  deleteAsync: vi.fn(async (uri: string) => {
    files.delete(uri);
  }),
}));

const {
  loadBackendSettings,
  saveBackendSettings,
  clearBackendSettings,
  isBackendReady,
  keyFingerprint,
  checkConnection,
  submitAndAwaitResult,
  requestLivenessChallenge,
} = await import("../../src/backend/backendClient");
const { appConfig } = await import("../../src/config");

async function generateKeyPair() {
  const keyPair = (await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const spki = Buffer.from(await webcrypto.subtle.exportKey("spki", keyPair.publicKey)).toString("base64");
  return { keyPair, spki };
}

const unsignedResult = {
  verificationId: "vid-1",
  verdict: "authentic",
  document: { type: "ePassport", issuingCountry: "UTO", fields: {} },
  trustChain: { source: "icao-pkd", level: "high", sufficientForClientPolicy: true, revocationChecked: true, revoked: false },
  anomalies: [],
  verifiedAt: "2026-01-01T00:01:00.000Z",
} as unknown as Omit<VerificationResult, "signature">;

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe("backendClient", () => {
  beforeEach(() => {
    files.clear();
    appConfig.apiBaseUrl = "https://api.example.invalid";
    appConfig.apiKey = "";
  });

  it("réglages : rien par défaut, enregistrés puis relus (URL normalisée), effaçables", async () => {
    expect(await loadBackendSettings()).toBeNull();
    await saveBackendSettings({ apiBaseUrl: " https://kyc.example.com/// ", apiKey: "k" });
    const loaded = await loadBackendSettings();
    expect(loaded).toEqual({ apiBaseUrl: "https://kyc.example.com", apiKey: "k" });
    expect(isBackendReady(loaded)).toBe(false); // clé de signature pas encore épinglée
    await clearBackendSettings();
    expect(await loadBackendSettings()).toBeNull();
  });

  it("empreinte lisible : 8 groupes de 4 caractères hexadécimaux", async () => {
    const { spki } = await generateKeyPair();
    expect(keyFingerprint(spki)).toMatch(/^([0-9A-F]{4} ){7}[0-9A-F]{4}$/);
    // Même empreinte que celle affichée par apps/api scripts/generate-*signing-key.ts.
    const hex = createHash("sha256").update(Buffer.from(spki, "base64")).digest("hex").slice(0, 32).toUpperCase();
    expect(keyFingerprint(spki)).toBe(hex.match(/..../g)!.join(" "));
  });

  it("checkConnection : santé, clé API acceptée et clés publiques récupérées", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/health")) return jsonResponse({ status: "ok" });
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer k");
      if (url.endsWith("/v1/verifications/signing-key")) return jsonResponse({ publicKeySpkiBase64: "UkVT" });
      return jsonResponse({ publicKeySpkiBase64: "QlVO" });
    });
    const check = await checkConnection("https://kyc.example.com/", "k", fetchMock as unknown as typeof fetch);
    expect(check).toEqual({ reachable: true, apiKeyAccepted: true, resultSigningKeySpkiBase64: "UkVT", cscaBundleSigningKeySpkiBase64: "QlVO", error: undefined });
  });

  it("checkConnection : clé API refusée", async () => {
    const fetchMock = vi.fn(async (url: string) => (url.endsWith("/health") ? jsonResponse({}) : jsonResponse({}, 401)));
    const check = await checkConnection("https://kyc.example.com", "mauvaise", fetchMock as unknown as typeof fetch);
    expect(check.reachable).toBe(true);
    expect(check.apiKeyAccepted).toBe(false);
  });

  it("requestLivenessChallenge : POST authentifié, heures d'envoi/réception pour caler l'horloge ; réponse invalide refusée", async () => {
    const challenge = { nonce: "n", steps: [{ action: "blink", windowStartMs: 3000, windowEndMs: 5500 }], issuedAt: 1, expiresAt: 2 };
    const fetchMock = vi.fn(async () => jsonResponse({ challenge, signature: "ab" }, 201));
    const issued = await requestLivenessChallenge({ apiBaseUrl: "https://kyc.example.com/", apiKey: "k" }, fetchMock as unknown as typeof fetch);
    expect(issued.challenge).toEqual(challenge);
    expect(issued.signature).toBe("ab");
    expect(issued.receivedAt).toBeGreaterThanOrEqual(issued.sentAt);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://kyc.example.com/v1/verifications/liveness-challenge");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");

    const bad = vi.fn(async () => jsonResponse({ nope: true }));
    await expect(requestLivenessChallenge({ apiBaseUrl: "https://kyc.example.com", apiKey: "k" }, bad as unknown as typeof fetch)).rejects.toThrow("réponse inattendue");
    const refused = vi.fn(async () => jsonResponse({}, 401));
    await expect(requestLivenessChallenge({ apiBaseUrl: "https://kyc.example.com", apiKey: "k" }, refused as unknown as typeof fetch)).rejects.toThrow("HTTP 401");
  });

  it("submitAndAwaitResult : attend le traitement (404) puis vérifie la signature contre la clé épinglée", async () => {
    const { keyPair, spki } = await generateKeyPair();
    const signed = { ...unsignedResult, signature: await signJsonPayload(unsignedResult, keyPair.privateKey) } as VerificationResult;
    let polls = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        expect(JSON.parse(init.body as string)).toMatchObject({ documentType: "ePassport", chipData: "Y2hpcA==" });
        return jsonResponse({ verificationId: "vid-1" }, 202);
      }
      polls++;
      return polls < 2 ? jsonResponse({}, 404) : jsonResponse(signed);
    });
    const settings = { apiBaseUrl: "https://kyc.example.com", apiKey: "k", resultSigningKeySpkiBase64: spki };
    const submission = { documentType: "ePassport" as const, chipDataBase64: "Y2hpcA==" };

    const outcome = await submitAndAwaitResult(settings, submission, { pollMs: 1, fetchImpl: fetchMock as unknown as typeof fetch });
    expect(outcome).toMatchObject({ kind: "result", signatureValid: true, verificationId: "vid-1" });

    // Résultat altéré (verdict changé après signature) : rendu, mais jamais comme faisant foi.
    const tampered = { ...signed, verdict: "fraudulent" } as VerificationResult;
    const tamperedFetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? jsonResponse({ verificationId: "vid-1" }, 202) : jsonResponse(tampered),
    );
    const tamperedOutcome = await submitAndAwaitResult(settings, submission, { pollMs: 1, fetchImpl: tamperedFetch as unknown as typeof fetch });
    expect(tamperedOutcome).toMatchObject({ kind: "result", signatureValid: false });
  });

  it("submitAndAwaitResult : en attente au-delà du délai, échec si l'envoi est refusé", async () => {
    const settings = { apiBaseUrl: "https://kyc.example.com", apiKey: "k", resultSigningKeySpkiBase64: "AA==" };
    const submission = { documentType: "eID" as const, chipDataBase64: "AA==" };
    const pendingFetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? jsonResponse({ verificationId: "vid-2" }, 202) : jsonResponse({}, 404),
    );
    expect(await submitAndAwaitResult(settings, submission, { pollMs: 1, timeoutMs: 20, fetchImpl: pendingFetch as unknown as typeof fetch })).toEqual({
      kind: "pending",
      verificationId: "vid-2",
    });

    const refusedFetch = vi.fn(async () => jsonResponse({}, 403));
    expect(await submitAndAwaitResult(settings, submission, { fetchImpl: refusedFetch as unknown as typeof fetch })).toEqual({
      kind: "failed",
      error: "Envoi refusé : HTTP 403",
    });
  });
});
