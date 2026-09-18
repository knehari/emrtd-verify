import { describe, it, expect, vi } from "vitest";
import { AuditService } from "../../src/modules/audit/audit.service";

describe("AuditService.purgeExpired", () => {
  it("ne fait rien quand aucune vérification n'a dépassé la rétention", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const auditDeleteMany = vi.fn();
    const verificationDeleteMany = vi.fn();
    const tx = { verificationRecord: { findMany, deleteMany: verificationDeleteMany }, auditLogEntry: { deleteMany: auditDeleteMany } };
    const prisma = { $transaction: vi.fn((callback: (tx: unknown) => unknown) => callback(tx)) } as never;

    const service = new AuditService(prisma);
    const result = await service.purgeExpired(30);

    expect(result).toEqual({ purgedVerificationCount: 0 });
    expect(auditDeleteMany).not.toHaveBeenCalled();
    expect(verificationDeleteMany).not.toHaveBeenCalled();
  });

  it("purge le journal d'audit puis les enregistrements de vérification expirés, dans cet ordre", async () => {
    const callOrder: string[] = [];
    const findMany = vi.fn().mockResolvedValue([{ verificationId: "a" }, { verificationId: "b" }]);
    const auditDeleteMany = vi.fn().mockImplementation(() => {
      callOrder.push("audit");
      return Promise.resolve();
    });
    const verificationDeleteMany = vi.fn().mockImplementation(() => {
      callOrder.push("verification");
      return Promise.resolve();
    });
    const tx = { verificationRecord: { findMany, deleteMany: verificationDeleteMany }, auditLogEntry: { deleteMany: auditDeleteMany } };
    const prisma = { $transaction: vi.fn((callback: (tx: unknown) => unknown) => callback(tx)) } as never;

    const service = new AuditService(prisma);
    const result = await service.purgeExpired(30);

    expect(result).toEqual({ purgedVerificationCount: 2 });
    expect(auditDeleteMany).toHaveBeenCalledWith({ where: { verificationId: { in: ["a", "b"] } } });
    expect(verificationDeleteMany).toHaveBeenCalledWith({ where: { verificationId: { in: ["a", "b"] } } });
    // Le journal d'audit doit être purgé avant les enregistrements qu'il référence.
    expect(callOrder).toEqual(["audit", "verification"]);
  });

  it("calcule la date de coupure à partir du nombre de jours de rétention", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const tx = { verificationRecord: { findMany, deleteMany: vi.fn() }, auditLogEntry: { deleteMany: vi.fn() } };
    const prisma = { $transaction: vi.fn((callback: (tx: unknown) => unknown) => callback(tx)) } as never;

    const before = Date.now();
    const service = new AuditService(prisma);
    await service.purgeExpired(30);
    const after = Date.now();

    const [{ where }] = findMany.mock.calls[0] as [{ where: { createdAt: { lt: Date } } }];
    const cutoffMs = where.createdAt.lt.getTime();
    const expectedMs = 30 * 24 * 60 * 60 * 1000;
    expect(cutoffMs).toBeGreaterThanOrEqual(before - expectedMs - 1000);
    expect(cutoffMs).toBeLessThanOrEqual(after - expectedMs + 1000);
  });
});
