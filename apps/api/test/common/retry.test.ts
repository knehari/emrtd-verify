import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { retryWithBackoff, computeBackoffDelayMs } from "../../src/common/resilience/retry";

describe("computeBackoffDelayMs", () => {
  it("croît exponentiellement avec la tentative, plafonné à maxDelayMs", () => {
    const alwaysMax = () => 1; // random() = 1 -> borne haute de l'intervalle "full jitter"
    expect(computeBackoffDelayMs(0, 100, 10_000, alwaysMax)).toBe(100);
    expect(computeBackoffDelayMs(1, 100, 10_000, alwaysMax)).toBe(200);
    expect(computeBackoffDelayMs(2, 100, 10_000, alwaysMax)).toBe(400);
    expect(computeBackoffDelayMs(10, 100, 10_000, alwaysMax)).toBe(10_000); // plafonné
  });

  it("retourne 0 quand random() = 0 (full jitter)", () => {
    expect(computeBackoffDelayMs(3, 100, 10_000, () => 0)).toBe(0);
  });
});

describe("retryWithBackoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retourne le résultat immédiatement si la 1re tentative réussit, sans attendre", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 1000 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retente après échec puis réussit, en respectant le délai de backoff", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("ok");

    const promise = retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 1000, random: () => 1 });

    // Laisse la 1re tentative (échouée) s'exécuter avant d'avancer le temps du sleep.
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("relance la dernière erreur une fois maxAttempts épuisé", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("toujours en échec"));

    const promise = retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 10, random: () => 1 });
    // Absorbe le rejet potentiel avant que les assertions sur le compteur d'appels ne s'exécutent,
    // pour éviter un unhandled rejection tant que les timers n'ont pas avancé.
    promise.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(20);

    await expect(promise).rejects.toThrow("toujours en échec");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("ne retente pas quand shouldRetry retourne false", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("erreur client 4xx"));
    const shouldRetry = vi.fn().mockReturnValue(false);

    await expect(
      retryWithBackoff(fn, { maxAttempts: 5, baseDelayMs: 10, shouldRetry }),
    ).rejects.toThrow("erreur client 4xx");

    expect(fn).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledTimes(1);
  });

  it("rejette immédiatement si maxAttempts < 1", async () => {
    await expect(
      retryWithBackoff(async () => "jamais atteint", { maxAttempts: 0, baseDelayMs: 10 }),
    ).rejects.toThrow("maxAttempts doit être >= 1");
  });
});
