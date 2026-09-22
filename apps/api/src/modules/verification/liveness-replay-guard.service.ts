import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Empêche la réutilisation d'un même nonce de challenge de liveness active — DISTINCT de
 * `LivenessChallengeService.verifyChallengeIntegrity` (qui vérifie que le challenge n'a pas été
 * modifié, pas qu'il n'a pas déjà servi). Ferme la limite explicitement documentée lors de la
 * première implémentation ("stateless par conception... pas l'usage unique du nonce") : cette
 * limite était honnête à l'époque (pas de composant d'infrastructure partagée réel pour la
 * vérifier sans le construire à l'aveugle) — désormais fermée avec une vraie table Postgres
 * (`ConsumedLivenessChallenge`, schema.prisma, migration réelle appliquée et vérifiée).
 *
 * Consommation atomique via la contrainte de clé primaire sur `nonce` : une violation de
 * contrainte unique (code Prisma P2002) signifie sans ambiguïté "déjà consommé", sans verrou
 * explicite ni condition de course entre deux requêtes concurrentes pour le même nonce — la base
 * de données elle-même arbitre l'atomicité, pas le code applicatif.
 */
@Injectable()
export class LivenessReplayGuardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tente de consommer ce nonce ; renvoie `true` à la première consommation (jamais vu), `false` s'il a déjà été consommé (rejeu détecté — même si la tentative précédente avait échoué). */
  async tryConsume(nonce: string, expiresAt: Date): Promise<boolean> {
    try {
      await this.prisma.consumedLivenessChallenge.create({ data: { nonce, expiresAt } });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return false;
      }
      throw error;
    }
  }
}
