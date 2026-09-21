import { describe, it, expect, vi } from "vitest";
import { ConflictException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AdminVerificationsService } from "../../src/modules/admin-api/admin-verifications.service";

function buildService(record: unknown) {
  const findUnique = vi.fn().mockResolvedValue(record);
  const findMany = vi.fn().mockResolvedValue([]);
  const count = vi.fn().mockResolvedValue(0);
  const reviewCreate = vi.fn();
  const prisma = {
    verificationRecord: { findUnique, findMany, count },
    verificationReview: { create: reviewCreate },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops)),
  } as never;
  return { service: new AdminVerificationsService(prisma), findUnique, reviewCreate };
}

const baseRecord = {
  id: "vr-internal-1",
  verificationId: "vr-1",
  clientId: "acme-bank",
  verdict: "manual_review_required",
  result: { verificationId: "vr-1", verdict: "manual_review_required" },
  review: null,
};

describe("AdminVerificationsService.review", () => {
  it("lève une 404 pour une vérification inconnue", async () => {
    const { service } = buildService(null);
    await expect(
      service.review("inconnu", "admin-1", { outcome: "CONFIRMED_AUTHENTIC", reason: "Document confirmé authentique" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejette la revue d'une vérification dont le verdict n'est pas manual_review_required", async () => {
    const { service } = buildService({ ...baseRecord, verdict: "authentic" });
    await expect(
      service.review("vr-1", "admin-1", { outcome: "CONFIRMED_AUTHENTIC", reason: "Sans objet" }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("crée la revue et la relie au bon enregistrement/opérateur", async () => {
    const { service, reviewCreate } = buildService(baseRecord);
    reviewCreate.mockResolvedValue({
      id: "review-1",
      verificationRecordId: baseRecord.id,
      reviewerId: "admin-1",
      outcome: "CONFIRMED_AUTHENTIC",
      reason: "Document confirmé authentique après examen manuel",
      reviewedAt: new Date(),
      reviewer: { id: "admin-1", email: "ops@example.org" },
    });

    const result = await service.review("vr-1", "admin-1", {
      outcome: "CONFIRMED_AUTHENTIC",
      reason: "Document confirmé authentique après examen manuel",
    });

    expect(reviewCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          verificationRecordId: baseRecord.id,
          reviewerId: "admin-1",
          outcome: "CONFIRMED_AUTHENTIC",
          reason: "Document confirmé authentique après examen manuel",
        },
      }),
    );
    expect(result.reviewer).toEqual({ id: "admin-1", email: "ops@example.org" });
  });

  it("rejette une seconde revue du même cas (contrainte unique verificationRecordId)", async () => {
    const { service, reviewCreate } = buildService(baseRecord);
    reviewCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "5.22.0" }),
    );

    await expect(
      service.review("vr-1", "admin-1", { outcome: "CONFIRMED_AUTHENTIC", reason: "Déjà revu" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("AdminVerificationsService.get", () => {
  it("expose review: null pour un cas jamais revu", async () => {
    const { service } = buildService(baseRecord);
    const result = await service.get("vr-1");
    expect(result.review).toBeNull();
  });

  it("expose la revue existante (issue, motif, opérateur) quand elle existe", async () => {
    const reviewedAt = new Date();
    const { service } = buildService({
      ...baseRecord,
      review: {
        outcome: "CONFIRMED_REJECTED",
        reason: "Document falsifié détecté",
        reviewedAt,
        reviewer: { id: "admin-2", email: "reviewer@example.org" },
      },
    });
    const result = await service.get("vr-1");
    expect(result.review).toEqual({
      outcome: "CONFIRMED_REJECTED",
      reason: "Document falsifié détecté",
      reviewedAt,
      reviewer: { id: "admin-2", email: "reviewer@example.org" },
    });
  });
});
