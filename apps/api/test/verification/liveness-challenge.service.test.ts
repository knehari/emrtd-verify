import { describe, it, expect } from "vitest";
import { ConfigService } from "@nestjs/config";
import { LivenessChallengeService } from "../../src/modules/verification/liveness-challenge.service";

function configWith(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as ConfigService;
}

describe("LivenessChallengeService", () => {
  it("issue() produit un challenge avec au moins une étape et une signature non vide", () => {
    const service = new LivenessChallengeService(configWith({ LIVENESS_CHALLENGE_SIGNING_SECRET: "test-secret" }));
    const signed = service.issue();
    expect(signed.challenge.steps.length).toBeGreaterThan(0);
    expect(signed.signature.length).toBeGreaterThan(0);
  });

  it("verifyChallengeIntegrity() accepte un challenge non modifié", () => {
    const service = new LivenessChallengeService(configWith({ LIVENESS_CHALLENGE_SIGNING_SECRET: "test-secret" }));
    const signed = service.issue();
    expect(service.verifyChallengeIntegrity(signed)).toBe(true);
  });

  it("verifyChallengeIntegrity() rejette un challenge dont une fenêtre temporelle a été modifiée (forge côté client)", () => {
    const service = new LivenessChallengeService(configWith({ LIVENESS_CHALLENGE_SIGNING_SECRET: "test-secret" }));
    const signed = service.issue();
    const tampered = { ...signed, challenge: { ...signed.challenge, steps: [{ ...signed.challenge.steps[0], windowEndMs: signed.challenge.steps[0].windowEndMs + 60_000 }, ...signed.challenge.steps.slice(1)] } };
    expect(service.verifyChallengeIntegrity(tampered)).toBe(false);
  });

  it("verifyChallengeIntegrity() rejette un challenge dont l'expiry a été prolongée", () => {
    const service = new LivenessChallengeService(configWith({ LIVENESS_CHALLENGE_SIGNING_SECRET: "test-secret" }));
    const signed = service.issue();
    const tampered = { ...signed, challenge: { ...signed.challenge, expiresAt: signed.challenge.expiresAt + 3_600_000 } };
    expect(service.verifyChallengeIntegrity(tampered)).toBe(false);
  });

  it("verifyChallengeIntegrity() rejette une signature arbitraire", () => {
    const service = new LivenessChallengeService(configWith({ LIVENESS_CHALLENGE_SIGNING_SECRET: "test-secret" }));
    const signed = service.issue();
    expect(service.verifyChallengeIntegrity({ ...signed, signature: "00".repeat(32) })).toBe(false);
  });

  it("verifyChallengeIntegrity() ne lève pas sur une signature malformée (pas de l'hexadécimal)", () => {
    const service = new LivenessChallengeService(configWith({ LIVENESS_CHALLENGE_SIGNING_SECRET: "test-secret" }));
    const signed = service.issue();
    expect(() => service.verifyChallengeIntegrity({ ...signed, signature: "pas-hex!" })).not.toThrow();
    expect(service.verifyChallengeIntegrity({ ...signed, signature: "pas-hex!" })).toBe(false);
  });

  it("un secret différent invalide un challenge par ailleurs identique (chaque déploiement doit configurer son propre secret)", () => {
    const serviceA = new LivenessChallengeService(configWith({ LIVENESS_CHALLENGE_SIGNING_SECRET: "secret-a" }));
    const serviceB = new LivenessChallengeService(configWith({ LIVENESS_CHALLENGE_SIGNING_SECRET: "secret-b" }));
    const signed = serviceA.issue();
    expect(serviceB.verifyChallengeIntegrity(signed)).toBe(false);
  });

  it("fonctionne (avec un avertissement) même sans secret configuré — ne bloque jamais le développement local", () => {
    const service = new LivenessChallengeService(configWith({}));
    const signed = service.issue();
    expect(service.verifyChallengeIntegrity(signed)).toBe(true);
  });

  it("émet la variante par défaut (3 actions, pas de challenge lumineux) quand aucune politique de risque n'est fournie", () => {
    const service = new LivenessChallengeService(configWith({ LIVENESS_CHALLENGE_SIGNING_SECRET: "test-secret" }));
    const signed = service.issue();
    expect(signed.challenge.steps).toHaveLength(3);
    expect(signed.challenge.lightSequence).toBeUndefined();
  });

  it("émet la variante par défaut quand la politique de risque accepte le niveau low", () => {
    const service = new LivenessChallengeService(configWith({ LIVENESS_CHALLENGE_SIGNING_SECRET: "test-secret" }));
    const signed = service.issue(["high", "medium", "low"]);
    expect(signed.challenge.steps).toHaveLength(3);
    expect(signed.challenge.lightSequence).toBeUndefined();
  });

  it("émet la variante stricte (4 actions + challenge lumineux) quand la politique de risque n'accepte PAS le niveau low", () => {
    const service = new LivenessChallengeService(configWith({ LIVENESS_CHALLENGE_SIGNING_SECRET: "test-secret" }));
    const signed = service.issue(["high"]);
    expect(signed.challenge.steps).toHaveLength(4);
    expect(signed.challenge.lightSequence).toBeDefined();
    expect(signed.challenge.lightSequence!.length).toBeGreaterThan(0);
  });

  it("une signature émise pour la variante stricte reste vérifiable normalement", () => {
    const service = new LivenessChallengeService(configWith({ LIVENESS_CHALLENGE_SIGNING_SECRET: "test-secret" }));
    const signed = service.issue(["high"]);
    expect(service.verifyChallengeIntegrity(signed)).toBe(true);
  });
});
