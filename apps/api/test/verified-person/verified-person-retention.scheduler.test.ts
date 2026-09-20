import { describe, it, expect, vi } from "vitest";
import { VerifiedPersonRetentionScheduler } from "../../src/modules/verified-person/verified-person-retention.scheduler";
import type { VerifiedPersonService } from "../../src/modules/verified-person/verified-person.service";
import type { ConfigService } from "@nestjs/config";

function buildScheduler(retentionDaysValue: string | undefined, anonymizeExpired: ReturnType<typeof vi.fn>) {
  const verifiedPersonService = { anonymizeExpired } as unknown as VerifiedPersonService;
  const config = { get: vi.fn().mockReturnValue(retentionDaysValue) } as unknown as ConfigService;
  return new VerifiedPersonRetentionScheduler(verifiedPersonService, config);
}

describe("VerifiedPersonRetentionScheduler.anonymizeExpiredVerifiedPersons", () => {
  it("utilise VERIFIED_PERSON_RETENTION_DAYS depuis la configuration quand renseignée", async () => {
    const anonymizeExpired = vi.fn().mockResolvedValue({ anonymizedCount: 0 });
    const scheduler = buildScheduler("365", anonymizeExpired);

    await scheduler.anonymizeExpiredVerifiedPersons();

    expect(anonymizeExpired).toHaveBeenCalledWith(365);
  });

  it("ne fait rien (aucun appel) quand VERIFIED_PERSON_RETENTION_DAYS est absent — pas de valeur par défaut", async () => {
    const anonymizeExpired = vi.fn().mockResolvedValue({ anonymizedCount: 0 });
    const scheduler = buildScheduler(undefined, anonymizeExpired);

    await scheduler.anonymizeExpiredVerifiedPersons();

    expect(anonymizeExpired).not.toHaveBeenCalled();
  });

  it("ne fait rien pour une valeur non numérique ou négative", async () => {
    const anonymizeExpired = vi.fn().mockResolvedValue({ anonymizedCount: 0 });
    const scheduler = buildScheduler("not-a-number", anonymizeExpired);

    await scheduler.anonymizeExpiredVerifiedPersons();

    expect(anonymizeExpired).not.toHaveBeenCalled();

    const negativeScheduler = buildScheduler("-5", anonymizeExpired);
    await negativeScheduler.anonymizeExpiredVerifiedPersons();
    expect(anonymizeExpired).not.toHaveBeenCalled();
  });

  it("ne laisse jamais une anonymisation en échec remonter (le processus API ne doit pas planter)", async () => {
    const anonymizeExpired = vi.fn().mockRejectedValue(new Error("DB indisponible"));
    const scheduler = buildScheduler("365", anonymizeExpired);

    await expect(scheduler.anonymizeExpiredVerifiedPersons()).resolves.toBeUndefined();
  });
});
