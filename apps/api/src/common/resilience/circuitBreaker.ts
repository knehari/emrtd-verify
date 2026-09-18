/**
 * Disjoncteur (circuit breaker) générique — protège l'API d'une dépendance externe dégradée
 * (typiquement services/face-match) : au-delà d'un seuil d'échecs consécutifs, on cesse
 * d'appeler la dépendance pendant `resetTimeoutMs` (échec rapide) plutôt que de laisser
 * chaque requête HTTP entrante attendre un timeout complet sur un service déjà en panne.
 */
export type CircuitBreakerState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Nombre d'échecs consécutifs (à l'état "closed") avant ouverture du circuit. */
  failureThreshold: number;
  /** Durée (ms) pendant laquelle le circuit reste "open" avant de repasser en "half-open". */
  resetTimeoutMs: number;
  /** Nombre de succès consécutifs requis en "half-open" pour refermer le circuit. */
  successThreshold?: number;
  /** Horloge injectable pour les tests (vitest fake timers). */
  now?: () => number;
}

export class CircuitBreakerOpenError extends Error {
  constructor() {
    super("Circuit ouvert : dépendance externe considérée indisponible, appel court-circuité");
    this.name = "CircuitBreakerOpenError";
  }
}

/**
 * Instance à créer une fois par dépendance externe et réutiliser à chaque appel (état porté
 * par l'instance elle-même, jamais par une variable de module partagée entre dépendances —
 * voir FaceMatchClient pour l'usage).
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = "closed";
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private openedAt = 0;
  private readonly successThreshold: number;
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    if (options.failureThreshold < 1) {
      throw new Error("failureThreshold doit être >= 1");
    }
    if (options.resetTimeoutMs < 0) {
      throw new Error("resetTimeoutMs doit être >= 0");
    }
    this.successThreshold = options.successThreshold ?? 1;
    this.now = options.now ?? Date.now;
  }

  getState(): CircuitBreakerState {
    if (this.state === "open" && this.now() - this.openedAt >= this.options.resetTimeoutMs) {
      // Le délai de réinitialisation est écoulé : on autorise une tentative de sonde
      // ("half-open") sans attendre le prochain appel à execute() pour l'observer.
      this.state = "half-open";
      this.consecutiveSuccesses = 0;
    }
    return this.state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.getState();
    if (currentState === "open") {
      throw new CircuitBreakerOpenError();
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === "half-open") {
      this.consecutiveSuccesses += 1;
      if (this.consecutiveSuccesses >= this.successThreshold) {
        this.reset();
      }
      return;
    }
    this.consecutiveFailures = 0;
  }

  private onFailure(): void {
    if (this.state === "half-open") {
      // Un seul échec en sonde suffit à rouvrir : le service n'est manifestement pas rétabli.
      this.open();
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.options.failureThreshold) {
      this.open();
    }
  }

  private open(): void {
    this.state = "open";
    this.openedAt = this.now();
    this.consecutiveSuccesses = 0;
  }

  private reset(): void {
    this.state = "closed";
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
  }
}
