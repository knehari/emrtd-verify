import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJsonStringify, generateLivenessChallenge, type LivenessChallenge } from "@emrtd-verify/emrtd-core";
import type { TrustLevel } from "../kyc/kyc-client.service";

/** Nombre d'actions pour un client dont la politique de risque accepte le niveau "low" — la plupart des clients KYC. */
const RELAXED_STEP_COUNT = 3;
/** Nombre d'actions + challenge lumineux requis pour un client dont la politique de risque exige "medium"/"high" uniquement — la variante la plus stricte du protocole (voir docs/facial-recognition.md "Détection de vivacité active"). */
const STRICT_STEP_COUNT = 4;
/** Avant la première action : réception du challenge par le mobile (réseau) puis lecture de la première consigne. */
const LEAD_IN_MS = 3000;

export interface SignedLivenessChallenge {
  challenge: LivenessChallenge;
  /** HMAC-SHA256 hexadécimal du challenge, calculé avec le secret serveur — empêche un client de
   * forger ses propres fenêtres temporelles/expiry avant de soumettre sa réponse (voir verify()).
   * La propriété de sécurité vérifiée ICI est "ce challenge est bien celui émis par ce serveur, non
   * modifié" — l'usage unique (single-use) du nonce est une propriété DISTINCTE, désormais vérifiée
   * séparément par `LivenessReplayGuardService` (table Postgres `ConsumedLivenessChallenge`), pas
   * par ce service. */
  signature: string;
}

/**
 * Émission et vérification d'intégrité du challenge de liveness active (voir
 * packages/emrtd-core/src/liveness/challenge.ts pour la génération du contenu du challenge
 * lui-même, indépendante de ce service). Signature HMAC-SHA256 symétrique (pas ECDSA comme
 * ResultSignerService) : ce challenge est émis ET vérifié par la même partie (ce serveur), jamais
 * transmis à un tiers qui aurait besoin de le vérifier sans détenir le secret — un HMAC suffit et
 * évite la complexité d'une paire de clés asymétrique pour ce cas d'usage.
 */
@Injectable()
export class LivenessChallengeService {
  private readonly logger = new Logger(LivenessChallengeService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * `acceptedTrustLevels` (politique de risque du client KYC appelant, voir
   * `AuthenticatedKycClient`/`request.kycClient`) module la difficulté du challenge : un client qui
   * n'accepte PAS le niveau "low" (politique de risque stricte) reçoit davantage d'actions ET le
   * canal challenge lumineux, un client plus permissif reçoit la variante par défaut. Un client
   * anonyme (`acceptedTrustLevels` omis) reçoit la variante par défaut — jamais la plus stricte par
   * défaut, pour ne pas bloquer silencieusement un appelant qui n'a pas encore cette information.
   */
  issue(acceptedTrustLevels?: TrustLevel[]): SignedLivenessChallenge {
    const requiresStrictPolicy = acceptedTrustLevels !== undefined && !acceptedTrustLevels.includes("low");
    const challenge = generateLivenessChallenge(
      requiresStrictPolicy
        ? { stepCount: STRICT_STEP_COUNT, requireLightChallenge: true, leadInMs: LEAD_IN_MS }
        : { stepCount: RELAXED_STEP_COUNT, leadInMs: LEAD_IN_MS },
    );
    return { challenge, signature: this.sign(challenge) };
  }

  /** Vérifie que le challenge soumis par le mobile est EXACTEMENT celui émis par ce serveur (fenêtres, nonce, expiry non modifiés) — condition préalable avant d'appeler `verifyLivenessResponse` sur la réponse elle-même. */
  verifyChallengeIntegrity(signed: SignedLivenessChallenge): boolean {
    const expectedHex = this.sign(signed.challenge);
    let expectedBuf: Buffer;
    let receivedBuf: Buffer;
    try {
      expectedBuf = Buffer.from(expectedHex, "hex");
      receivedBuf = Buffer.from(signed.signature, "hex");
    } catch {
      return false;
    }
    if (expectedBuf.length !== receivedBuf.length) {
      return false;
    }
    return timingSafeEqual(expectedBuf, receivedBuf);
  }

  private sign(challenge: LivenessChallenge): string {
    return createHmac("sha256", this.secret()).update(canonicalJsonStringify(challenge)).digest("hex");
  }

  private secret(): string {
    const secret = this.config.get<string>("LIVENESS_CHALLENGE_SIGNING_SECRET");
    if (!secret) {
      this.logger.warn(
        "LIVENESS_CHALLENGE_SIGNING_SECRET non configurée — utilisation d'un secret de développement non sécurisé. Ne jamais déployer en production sans cette variable définie (voir .env.example).",
      );
      return "insecure-development-only-liveness-challenge-secret";
    }
    return secret;
  }
}
