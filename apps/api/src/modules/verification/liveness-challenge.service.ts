import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJsonStringify, generateLivenessChallenge, type LivenessChallenge } from "@emrtd-verify/emrtd-core";

export interface SignedLivenessChallenge {
  challenge: LivenessChallenge;
  /** HMAC-SHA256 hexadécimal du challenge, calculé avec le secret serveur — empêche un client de
   * forger ses propres fenêtres temporelles/expiry avant de soumettre sa réponse (voir verify()).
   * Stateless par conception (pas de stockage Redis/DB du challenge émis) : la propriété de
   * sécurité vérifiée est "ce challenge est bien celui émis par ce serveur, non modifié", pas
   * l'usage unique (single-use) du nonce — une protection anti-rejeu par nonce nécessiterait un
   * cache partagé multi-instance, non implémenté ici (même limite honnête que
   * docs/pvid-compliance.md pour la CRL/PKD : pas construit à l'aveugle sans le composant
   * d'infrastructure partagée réel pour le vérifier). */
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

  issue(): SignedLivenessChallenge {
    const challenge = generateLivenessChallenge();
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
