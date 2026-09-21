import { describe, it, expect, vi, afterEach } from "vitest";
import { createHttpsLostStolenRegistry, notConfiguredLostStolenRegistry } from "../../src/modules/document-status/lost-stolen-registry";

describe("notConfiguredLostStolenRegistry", () => {
  it("retourne toujours checked:false, reported:false (jamais interprété comme non signalé)", async () => {
    const result = await notConfiguredLostStolenRegistry.checkStatus({ issuingState: "FRA", documentNumber: "12AB34567" });
    expect(result).toEqual({ checked: false, reported: false });
  });
});

describe("createHttpsLostStolenRegistry", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("interpole issuingState et documentNumber dans le gabarit d'URL", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reported: false }) });

    const registry = createHttpsLostStolenRegistry({
      checkUrlTemplate: "https://registry.example.org/status/{issuingState}/{documentNumber}",
    });
    await registry.checkStatus({ issuingState: "FRA", documentNumber: "12AB34567" });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://registry.example.org/status/FRA/12AB34567",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("retourne checked:true, reported:true quand le registre signale le document", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reported: true }) });

    const registry = createHttpsLostStolenRegistry({ checkUrlTemplate: "https://registry.example.org/status/{issuingState}/{documentNumber}" });
    const result = await registry.checkStatus({ issuingState: "FRA", documentNumber: "12AB34567" });

    expect(result).toEqual({ checked: true, reported: true });
  });

  it("retourne checked:true, reported:false quand le registre ne signale rien", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reported: false }) });

    const registry = createHttpsLostStolenRegistry({ checkUrlTemplate: "https://registry.example.org/status/{issuingState}/{documentNumber}" });
    const result = await registry.checkStatus({ issuingState: "FRA", documentNumber: "12AB34567" });

    expect(result).toEqual({ checked: true, reported: false });
  });

  it("envoie l'en-tête Authorization Bearer quand une clé API est configurée", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reported: false }) });

    const registry = createHttpsLostStolenRegistry({
      checkUrlTemplate: "https://registry.example.org/status/{issuingState}/{documentNumber}",
      apiKey: "secret-key",
    });
    await registry.checkStatus({ issuingState: "FRA", documentNumber: "12AB34567" });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ headers: { Authorization: "Bearer secret-key" } }),
    );
  });

  it("retourne checked:false plutôt que de lever une erreur sur une réponse HTTP en échec", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: "Service Unavailable" });

    const registry = createHttpsLostStolenRegistry({ checkUrlTemplate: "https://registry.example.org/status/{issuingState}/{documentNumber}" });
    const result = await registry.checkStatus({ issuingState: "FRA", documentNumber: "12AB34567" });

    expect(result).toEqual({ checked: false, reported: false });
  });

  it("retourne checked:false plutôt que de lever une erreur si fetch échoue (réseau, timeout)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network error"));

    const registry = createHttpsLostStolenRegistry({ checkUrlTemplate: "https://registry.example.org/status/{issuingState}/{documentNumber}" });
    const result = await registry.checkStatus({ issuingState: "FRA", documentNumber: "12AB34567" });

    expect(result).toEqual({ checked: false, reported: false });
  });
});
