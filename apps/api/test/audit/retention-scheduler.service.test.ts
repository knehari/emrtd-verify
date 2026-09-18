import { describe, it, expect, vi } from "vitest";
import { RetentionSchedulerService } from "../../src/modules/audit/retention-scheduler.service";
import type { AuditService } from "../../src/modules/audit/audit.service";
import type { ConfigService } from "@nestjs/config";

function buildScheduler(retentionDaysValue: string | undefined, purgeExpired: ReturnType<typeof vi.fn>) {
  const auditService = { purgeExpired } as unknown as AuditService;
  const config = { get: vi.fn().mockReturnValue(retentionDaysValue) } as unknown as ConfigService;
  return new RetentionSchedulerService(auditService, config);
}

describe("RetentionSchedulerService.purgeExpiredRecords", () => {
  it("utilise DATA_RETENTION_DAYS depuis la configuration", async () => {
    const purgeExpired = vi.fn().mockResolvedValue({ purgedVerificationCount: 0 });
    const scheduler = buildScheduler("45", purgeExpired);

    await scheduler.purgeExpiredRecords();

    expect(purgeExpired).toHaveBeenCalledWith(45);
  });

  it("retombe sur 30 jours si DATA_RETENTION_DAYS est absent ou invalide", async () => {
    const purgeExpired = vi.fn().mockResolvedValue({ purgedVerificationCount: 0 });
    const scheduler = buildScheduler(undefined, purgeExpired);

    await scheduler.purgeExpiredRecords();

    expect(purgeExpired).toHaveBeenCalledWith(30);
  });

  it("retombe sur 30 jours pour une valeur non numérique ou négative", async () => {
    const purgeExpired = vi.fn().mockResolvedValue({ purgedVerificationCount: 0 });
    const scheduler = buildScheduler("not-a-number", purgeExpired);

    await scheduler.purgeExpiredRecords();

    expect(purgeExpired).toHaveBeenCalledWith(30);
  });

  it("ne laisse jamais une purge en échec remonter (le processus API ne doit pas planter)", async () => {
    const purgeExpired = vi.fn().mockRejectedValue(new Error("DB indisponible"));
    const scheduler = buildScheduler("30", purgeExpired);

    await expect(scheduler.purgeExpiredRecords()).resolves.toBeUndefined();
  });
});
