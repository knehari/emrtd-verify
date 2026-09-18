import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { FaceMatchResult } from "@emrtd-verify/shared-types";
import { retryWithBackoff } from "../../common/resilience/retry";
import { CircuitBreaker, CircuitBreakerOpenError } from "../../common/resilience/circuitBreaker";

export interface FaceMatchRequest {
  /** Image DG2 extraite de la puce. */
  referenceImage: Uint8Array;
  /** Capture vivante côté mobile. */
  probeImage: Uint8Array;
}

const REQUEST_TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 200;

/**
 * Erreur "propre" à distinguer d'un échec HTTP normal ; ni 4xx (jamais retentée) ni 5xx —
 * marque un dépassement du budget temps alloué au service face-match.
 */
export class FaceMatchTimeoutError extends Error {
  constructor() {
    super(`services/face-match n'a pas répondu dans le délai imparti (${REQUEST_TIMEOUT_MS}ms)`);
    this.name = "FaceMatchTimeoutError";
  }
}

/**
 * Client HTTP interne vers services/face-match. L'API ne traite jamais elle-même
 * une image de visage : elle délègue systématiquement et ne conserve que le score
 * retourné (voir docs/facial-recognition.md et docs/gdpr-compliance.md).
 *
 * Résilience : timeout par requête (AbortController), backoff exponentiel avec jitter sur les
 * échecs transitoires (réseau, 5xx), et un disjoncteur pour échouer vite plutôt que de laisser
 * chaque vérification entrante attendre un service face-match en détresse — sans ce disjoncteur,
 * une panne de services/face-match dégraderait tout le pipeline de vérification en cascade.
 */
@Injectable()
export class FaceMatchClient {
  private readonly logger = new Logger(FaceMatchClient.name);

  // Une seule instance par processus API, partagée entre toutes les requêtes vers
  // services/face-match : l'état du disjoncteur doit refléter la santé réelle de CETTE
  // dépendance dans son ensemble, pas être réinitialisé à chaque appel (instance de classe,
  // volontairement pas un état mutable au niveau module partagé entre plusieurs dépendances).
  private readonly circuitBreaker = new CircuitBreaker({
    failureThreshold: 5,
    resetTimeoutMs: 30_000,
    successThreshold: 1,
  });

  constructor(private readonly config: ConfigService) {}

  async compare(request: FaceMatchRequest): Promise<FaceMatchResult> {
    try {
      return await this.circuitBreaker.execute(() =>
        retryWithBackoff(() => this.doCompare(request), {
          maxAttempts: MAX_ATTEMPTS,
          baseDelayMs: RETRY_BASE_DELAY_MS,
          shouldRetry: (error) => !(error instanceof FaceMatchClientError),
        }),
      );
    } catch (error) {
      if (error instanceof CircuitBreakerOpenError) {
        this.logger.warn("Appel à services/face-match court-circuité (disjoncteur ouvert)");
      }
      throw error;
    }
  }

  private async doCompare(request: FaceMatchRequest): Promise<FaceMatchResult> {
    const baseUrl = this.config.get<string>("FACE_MATCH_URL");
    const apiKey = this.config.get<string>("FACE_MATCH_API_KEY");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/v1/compare`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          reference_image: Buffer.from(request.referenceImage).toString("base64"),
          probe_image: Buffer.from(request.probeImage).toString("base64"),
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new FaceMatchTimeoutError();
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      // 4xx : requête malformée de notre côté, retenter n'y changerait rien -> FaceMatchClientError
      // (non retentée). 5xx : panne transitoire côté service -> laissée à retryWithBackoff.
      const message = `services/face-match a répondu ${response.status}`;
      if (response.status >= 400 && response.status < 500) {
        throw new FaceMatchClientError(message);
      }
      throw new Error(message);
    }

    const body = (await response.json()) as {
      similarity_score: number;
      match_decision: FaceMatchResult["matchDecision"];
      liveness_passed: boolean;
      quality_warnings: string[];
    };

    return {
      similarityScore: body.similarity_score,
      matchDecision: body.match_decision,
      livenessPassed: body.liveness_passed,
      qualityWarnings: body.quality_warnings,
    };
  }
}

/** Erreur non transitoire (requête invalide) — ne doit jamais être retentée. */
class FaceMatchClientError extends Error {}
