import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LocalVerificationResult } from "../../src/verification/localVerification";
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
}));

const { enqueueSubmission, getQueuedSubmissions, submitPendingSubmissions, reconcileSubmittedResults, runSyncCycle, pruneReconciled } = await import(
  "../../src/sync/submissionQueue"
);
const { appConfig } = await import("../../src/config");

const sampleLocalResult: LocalVerificationResult = {
  provisional: true,
  computedAt: "2026-01-01T00:00:00.000Z",
  verdict: "suspicious",
  document: { type: "ePassport", issuingCountry: "UTO", fields: {} },
  trustChain: { source: "icao-pkd", level: "high", sufficientForClientPolicy: true, revocationChecked: false, revoked: false },
  anomalies: [{ code: "LOST_STOLEN_STATUS_NOT_CHECKED", severity: "warning", message: "x" }],
};

const sampleServerResult: VerificationResult = {
  verificationId: "vid-1",
  verdict: "authentic",
  document: { type: "ePassport", issuingCountry: "UTO", fields: {} },
  trustChain: { source: "icao-pkd", level: "high", sufficientForClientPolicy: true, revocationChecked: true, revoked: false },
  anomalies: [],
  verifiedAt: "2026-01-01T00:01:00.000Z",
  signature: "sig",
};

async function enqueueSample() {
  return enqueueSubmission({
    documentType: "ePassport",
    chipDataBase64: "ZmFrZQ==",
    localResult: sampleLocalResult,
  });
}

describe("submissionQueue", () => {
  beforeEach(() => {
    files.clear();
    appConfig.apiBaseUrl = "https://api.test.example";
    appConfig.apiKey = "test-key";
    vi.unstubAllGlobals();
  });

  it("enqueueSubmission persiste un élément pending, retrouvable via getQueuedSubmissions", async () => {
    const item = await enqueueSample();
    expect(item.status).toBe("pending");
    expect(item.attempts).toBe(0);

    const queue = await getQueuedSubmissions();
    expect(queue).toHaveLength(1);
    expect(queue[0]!.id).toBe(item.id);
    expect(queue[0]!.localResult).toEqual(sampleLocalResult);
  });

  it("submitPendingSubmissions transmet et passe l'élément à submitted avec son verificationId", async () => {
    await enqueueSample();
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("https://api.test.example/v1/verifications");
      return { ok: true, json: async () => ({ verificationId: "vid-1" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitPendingSubmissions();
    expect(result).toEqual({ attempted: 1, succeeded: 1 });

    const [item] = await getQueuedSubmissions();
    expect(item!.status).toBe("submitted");
    expect(item!.verificationId).toBe("vid-1");
    expect(item!.attempts).toBe(1);
  });

  it("laisse l'élément pending (sans lever) en cas de panne réseau, pour réessai ultérieur", async () => {
    await enqueueSample();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Network request failed");
      }),
    );

    const result = await submitPendingSubmissions();
    expect(result).toEqual({ attempted: 1, succeeded: 0 });

    const [item] = await getQueuedSubmissions();
    expect(item!.status).toBe("pending");
    expect(item!.attempts).toBe(1);
    expect(item!.lastError).toContain("Network request failed");
  });

  it("n'attend pas immédiatement un nouvel essai (backoff) tant que la fenêtre n'est pas écoulée", async () => {
    await enqueueSample();
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Network request failed");
    });
    vi.stubGlobal("fetch", fetchMock);

    await submitPendingSubmissions(); // 1er essai, échoue, programme le backoff
    await submitPendingSubmissions(); // immédiatement après : ne doit PAS retenter (backoff actif)

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reconcileSubmittedResults laisse l'élément submitted (sans erreur) sur un 404 — traitement serveur pas encore terminé", async () => {
    await enqueueSample();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ verificationId: "vid-1" }) })));
    await submitPendingSubmissions();

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    const result = await reconcileSubmittedResults();
    expect(result).toEqual({ attempted: 1, reconciled: 0 });

    const [item] = await getQueuedSubmissions();
    expect(item!.status).toBe("submitted");
  });

  it("reconcileSubmittedResults marque l'élément reconciled avec le VerificationResult signé une fois disponible", async () => {
    await enqueueSample();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ verificationId: "vid-1" }) })));
    await submitPendingSubmissions();

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      expect(url).toBe("https://api.test.example/v1/verifications/vid-1");
      return { ok: true, json: async () => sampleServerResult };
    }));
    const result = await reconcileSubmittedResults();
    expect(result).toEqual({ attempted: 1, reconciled: 1 });

    const [item] = await getQueuedSubmissions();
    expect(item!.status).toBe("reconciled");
    expect(item!.reconciledResult).toEqual(sampleServerResult);
    // Le résultat local provisoire reste inchangé — jamais écrasé par la réconciliation.
    expect(item!.localResult).toEqual(sampleLocalResult);
  });

  it("runSyncCycle enchaîne soumission puis réconciliation en un seul appel", async () => {
    await enqueueSample();
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        if (call === 1) return { ok: true, json: async () => ({ verificationId: "vid-1" }) };
        return { ok: true, json: async () => sampleServerResult };
      }),
    );

    const result = await runSyncCycle();
    expect(result).toEqual({ submitted: 1, reconciled: 1 });
  });

  it("sans serveur configuré, rien n'est tenté et tout reste en file", async () => {
    appConfig.apiBaseUrl = "https://api.example.invalid";
    await enqueueSample();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await submitPendingSubmissions()).toEqual({ attempted: 0, succeeded: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await getQueuedSubmissions())[0]!.status).toBe("pending");
  });

  it("pruneReconciled retire les éléments réconciliés anciens sans toucher aux autres", async () => {
    const oldItem = await enqueueSample();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ verificationId: "vid-1" }) })));
    await submitPendingSubmissions();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => sampleServerResult })));
    await reconcileSubmittedResults();

    // Force une date de création ancienne pour simuler l'ancienneté.
    const queue = await getQueuedSubmissions();
    files.set(
      "file:///mock-documents/submission-queue.json",
      JSON.stringify(queue.map((item) => (item.id === oldItem.id ? { ...item, createdAt: "2000-01-01T00:00:00.000Z" } : item))),
    );

    const removed = await pruneReconciled();
    expect(removed).toBe(1);
    expect(await getQueuedSubmissions()).toHaveLength(0);
  });
});
