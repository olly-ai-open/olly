-- AlterTable
ALTER TABLE "Brief" ADD COLUMN     "debugCapturedAt" TIMESTAMP(3),
ADD COLUMN     "debugMetadata" JSONB,
ADD COLUMN     "debugS3Key" TEXT;
