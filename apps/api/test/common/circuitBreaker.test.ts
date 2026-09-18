import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CircuitBreaker, CircuitBreakerOpenError } from "../../src/common/resilience/circuitBreaker";

describe("CircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reste fermé et laisse passer les appels tant que le seuil d'échecs n'est pas atteint", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
    const failing = () => Promise.reject(new Error("dépendance en échec"));

    await expect(breaker.execute(failing)).rejects.toThrow("dépendance en échec");
    await expect(breaker.execute(failing)).rejects.toThrow("dépendance en échec");
    expect(breaker.getState()).toBe("closed");
  });

  it("s'ouvre après le seuil d'échecs consécutifs et court-circuite les appels suivants", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000 });
    const failing = () => Promise.reject(new Error("dépendance en échec"));

    await expect(breaker.execute(failing)).rejects.toThrow("dépendance en échec");
    await expect(breaker.execute(failing)).rejects.toThrow("dépendance en échec");
    expect(breaker.getState()).toBe("open");

    const fnNeverCalled = vi.fn().mockResolvedValue("ne devrait jamais être appelé");
    await expect(breaker.execute(fnNeverCalled)).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    expect(fnNeverCalled).not.toHaveBeenCalled();
  });

  it("un succès réinitialise le compteur d'échecs consécutifs (n'ouvre pas prématurément)", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000 });
    const failing = () => Promise.reject(new Error("échec"));
    const succeeding = () => Promise.resolve("ok");

    await expect(breaker.execute(failing)).rejects.toThrow();
    await expect(breaker.execute(succeeding)).resolves.toBe("ok");
    await expect(breaker.execute(failing)).rejects.toThrow();
    // Deux échecs mais non consécutifs (un succès entre les deux) : le circuit doit rester fermé.
    expect(breaker.getState()).toBe("closed");
  });

  it("passe en half-open après resetTimeoutMs et se referme après un succès de sonde", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 5000 });
    const failing = () => Promise.reject(new Error("échec"));

    await expect(breaker.execute(failing)).rejects.toThrow();
    expect(breaker.getState()).toBe("open");

    vi.setSystemTime(4999);
    expect(breaker.getState()).toBe("open");

    vi.setSystemTime(5000);
    expect(breaker.getState()).toBe("half-open");

    const succeeding = () => Promise.resolve("rétabli");
    await expect(breaker.execute(succeeding)).resolves.toBe("rétabli");
    expect(breaker.getState()).toBe("closed");
  });

  it("un échec de sonde en half-open rouvre immédiatement le circuit", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 5000 });
    const failing = () => Promise.reject(new Error("échec"));

    await expect(breaker.execute(failing)).rejects.toThrow();
    vi.setSystemTime(5000);
    expect(breaker.getState()).toBe("half-open");

    await expect(breaker.execute(failing)).rejects.toThrow();
    expect(breaker.getState()).toBe("open");
  });

  it("respecte successThreshold > 1 avant de refermer le circuit depuis half-open", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000, successThreshold: 2 });
    const failing = () => Promise.reject(new Error("échec"));
    const succeeding = () => Promise.resolve("ok");

    await expect(breaker.execute(failing)).rejects.toThrow();
    vi.setSystemTime(1000);
    expect(breaker.getState()).toBe("half-open");

    await expect(breaker.execute(succeeding)).resolves.toBe("ok");
    expect(breaker.getState()).toBe("half-open"); // un seul succès, pas encore suffisant

    await expect(breaker.execute(succeeding)).resolves.toBe("ok");
    expect(breaker.getState()).toBe("closed");
  });

  it("rejette la construction avec des options invalides", () => {
    expect(() => new CircuitBreaker({ failureThreshold: 0, resetTimeoutMs: 1000 })).toThrow();
    expect(() => new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: -1 })).toThrow();
  });
});
