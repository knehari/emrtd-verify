import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { LivenessReplayGuardService } from "../../src/modules/verification/liveness-replay-guard.service";

function buildService() {
  const create = vi.fn().mockResolvedValue(undefined);
  const prisma = { consumedLivenessChallenge: { create } } as never;
  return { service: new LivenessReplayGuardService(prisma), create };
}

describe("LivenessReplayGuardService.tryConsume", () => {
  it("renvoie true à la première consommation d'un nonce", async () => {
    const { service, create } = buildService();
    const expiresAt = new Date();
    const result = await service.tryConsume("nonce-1", expiresAt);
    expect(result).toBe(true);
    expect(create).toHaveBeenCalledWith({ data: { nonce: "nonce-1", expiresAt } });
  });

  it("renvoie false si le nonce a déjà été consommé (violation de contrainte unique P2002)", async () => {
    const { service, create } = buildService();
    create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "5.22.0" }));
    const result = await service.tryConsume("nonce-2", new Date());
    expect(result).toBe(false);
  });

  it("propage toute autre erreur Prisma (ex. base de données indisponible) plutôt que de l'interpréter comme un rejeu", async () => {
    const { service, create } = buildService();
    create.mockRejectedValue(new Error("connexion refusée"));
    await expect(service.tryConsume("nonce-3", new Date())).rejects.toThrow("connexion refusée");
  });
});
