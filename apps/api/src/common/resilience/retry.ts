/**
 * Backoff exponentiel générique avec jitter — utilisé pour tout appel sortant potentiellement
 * instable (services/face-match, ICAO PKD). Le jitter évite un effet de meute ("thundering herd")
 * quand plusieurs requêtes échouent en même temps et retentent toutes au même instant.
 */
export interface RetryOptions {
  /** Nombre maximal de tentatives, tentative initiale incluse (>= 1). */
  maxAttempts: number;
  /** Délai de base (ms) avant la 1re retentative ; double à chaque tentative suivante. */
  baseDelayMs: number;
  /** Délai maximal (ms) plafonnant le backoff exponentiel. */
  maxDelayMs?: number;
  /** Permet de ne retenter que certaines erreurs (ex. pas les erreurs 4xx côté client). */
  shouldRetry?: (error: unknown) => boolean;
  /** Injectable pour les tests (vitest fake timers) ; par défaut setTimeout réel. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable pour les tests ; par défaut Math.random. */
  random?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calcule le délai d'attente avant la tentative `attempt` (0-based) avec jitter "full jitter"
 * (AWS Architecture Blog, "Exponential Backoff And Jitter") : délai tiré uniformément dans
 * [0, min(maxDelayMs, baseDelayMs * 2^attempt)] plutôt qu'un délai fixe, pour désynchroniser
 * les clients qui retentent en même temps.
 */
export function computeBackoffDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number = Math.random,
): number {
  const exponential = baseDelayMs * 2 ** attempt;
  const capped = Math.min(exponential, maxDelayMs);
  return Math.floor(random() * capped);
}

/**
 * Exécute `fn`, en retentant jusqu'à `maxAttempts` fois avec backoff exponentiel + jitter.
 * Relance la dernière erreur rencontrée si toutes les tentatives échouent.
 */
export async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs = baseDelayMs * 2 ** 10, shouldRetry, sleep = defaultSleep, random } =
    options;

  if (maxAttempts < 1) {
    throw new Error("maxAttempts doit être >= 1");
  }

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === maxAttempts - 1;
      const retryable = shouldRetry ? shouldRetry(error) : true;
      if (isLastAttempt || !retryable) {
        throw error;
      }
      const delayMs = computeBackoffDelayMs(attempt, baseDelayMs, maxDelayMs, random);
      await sleep(delayMs);
    }
  }

  // Inatteignable (la boucle retourne ou lève systématiquement) — satisfait le typage strict.
  throw lastError;
}
