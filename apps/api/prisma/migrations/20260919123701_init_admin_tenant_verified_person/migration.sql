-- CreateEnum
CREATE TYPE "CscaCertificateTrustState" AS ENUM ('DISCOVERED', 'PKD_OBSERVED', 'ICAO_ML_VALIDATED', 'LINK_VALIDATED', 'OUT_OF_BAND_VALIDATED', 'REVOKED_OR_DISTRUSTED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'SUPPORT');

-- CreateEnum
CREATE TYPE "TenantUserRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "VerifiedPersonStatus" AS ENUM ('VERIFIED', 'UNVERIFIED', 'PENDING_REVIEW', 'WATCHLIST');

-- CreateTable
CREATE TABLE "verification_records" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "issuingCountry" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "trustChainSource" TEXT NOT NULL,
    "trustChainLevel" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedPersonId" TEXT,

    CONSTRAINT "verification_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_clients" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "acceptedTrustLevels" TEXT[],
    "allowedFields" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log_entries" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "trustChainSource" TEXT NOT NULL,
    "anomalyCodes" TEXT[],
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "csca_sync_batches" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "masterListSignerSubject" TEXT NOT NULL,
    "certificateCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "csca_sync_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "csca_certificate_records" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "notBefore" TIMESTAMP(3) NOT NULL,
    "notAfter" TIMESTAMP(3) NOT NULL,
    "certificateDer" BYTEA NOT NULL,
    "trustState" "CscaCertificateTrustState" NOT NULL DEFAULT 'DISCOVERED',
    "sourceKind" TEXT NOT NULL,
    "validatedVia" TEXT,

    CONSTRAINT "csca_certificate_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "csca_trust_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "activeBatchId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "csca_trust_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_list_sync_runs" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "certificateCount" INTEGER,
    "errorMessage" TEXT,

    CONSTRAINT "master_list_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'SUPPORT',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "kycClientId" TEXT NOT NULL,
    "role" "TenantUserRole" NOT NULL DEFAULT 'MEMBER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verified_persons" (
    "id" TEXT NOT NULL,
    "kycClientId" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "status" "VerifiedPersonStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "documentType" TEXT NOT NULL,
    "issuingCountry" TEXT NOT NULL,
    "displayFields" JSONB NOT NULL,
    "watchlistReason" TEXT,
    "firstVerifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verificationCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verified_persons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "verification_records_verificationId_key" ON "verification_records"("verificationId");

-- CreateIndex
CREATE INDEX "verification_records_createdAt_idx" ON "verification_records"("createdAt");

-- CreateIndex
CREATE INDEX "verification_records_clientId_idx" ON "verification_records"("clientId");

-- CreateIndex
CREATE INDEX "verification_records_verifiedPersonId_idx" ON "verification_records"("verifiedPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_clients_clientId_key" ON "kyc_clients"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_clients_apiKeyHash_key" ON "kyc_clients"("apiKeyHash");

-- CreateIndex
CREATE INDEX "audit_log_entries_verificationId_idx" ON "audit_log_entries"("verificationId");

-- CreateIndex
CREATE INDEX "audit_log_entries_occurredAt_idx" ON "audit_log_entries"("occurredAt");

-- CreateIndex
CREATE INDEX "csca_sync_batches_createdAt_idx" ON "csca_sync_batches"("createdAt");

-- CreateIndex
CREATE INDEX "csca_certificate_records_batchId_countryCode_idx" ON "csca_certificate_records"("batchId", "countryCode");

-- CreateIndex
CREATE INDEX "csca_certificate_records_countryCode_trustState_idx" ON "csca_certificate_records"("countryCode", "trustState");

-- CreateIndex
CREATE INDEX "master_list_sync_runs_startedAt_idx" ON "master_list_sync_runs"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_users_email_key" ON "tenant_users"("email");

-- CreateIndex
CREATE INDEX "tenant_users_kycClientId_idx" ON "tenant_users"("kycClientId");

-- CreateIndex
CREATE INDEX "verified_persons_kycClientId_status_idx" ON "verified_persons"("kycClientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "verified_persons_kycClientId_matchKey_key" ON "verified_persons"("kycClientId", "matchKey");

-- AddForeignKey
ALTER TABLE "verification_records" ADD CONSTRAINT "verification_records_verifiedPersonId_fkey" FOREIGN KEY ("verifiedPersonId") REFERENCES "verified_persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "csca_certificate_records" ADD CONSTRAINT "csca_certificate_records_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "csca_sync_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_kycClientId_fkey" FOREIGN KEY ("kycClientId") REFERENCES "kyc_clients"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verified_persons" ADD CONSTRAINT "verified_persons_kycClientId_fkey" FOREIGN KEY ("kycClientId") REFERENCES "kyc_clients"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;
