-- AlterTable
ALTER TABLE "PlatformOperator" ADD COLUMN     "failedTotpAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totpLockedUntil" TIMESTAMP(3);

