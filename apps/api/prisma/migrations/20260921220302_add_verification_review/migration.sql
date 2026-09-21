-- CreateEnum
CREATE TYPE "VerificationReviewOutcome" AS ENUM ('CONFIRMED_AUTHENTIC', 'CONFIRMED_REJECTED', 'ESCALATED');

-- CreateTable
CREATE TABLE "verification_reviews" (
    "id" TEXT NOT NULL,
    "verificationRecordId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "outcome" "VerificationReviewOutcome" NOT NULL,
    "reason" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "verification_reviews_verificationRecordId_key" ON "verification_reviews"("verificationRecordId");

-- CreateIndex
CREATE INDEX "verification_reviews_reviewerId_idx" ON "verification_reviews"("reviewerId");

-- AddForeignKey
ALTER TABLE "verification_reviews" ADD CONSTRAINT "verification_reviews_verificationRecordId_fkey" FOREIGN KEY ("verificationRecordId") REFERENCES "verification_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_reviews" ADD CONSTRAINT "verification_reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
