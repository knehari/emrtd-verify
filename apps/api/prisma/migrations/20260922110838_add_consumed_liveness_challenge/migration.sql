-- CreateTable
CREATE TABLE "consumed_liveness_challenges" (
    "nonce" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consumed_liveness_challenges_pkey" PRIMARY KEY ("nonce")
);

-- CreateIndex
CREATE INDEX "consumed_liveness_challenges_expiresAt_idx" ON "consumed_liveness_challenges"("expiresAt");
