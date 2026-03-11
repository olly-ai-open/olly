-- AlterTable
ALTER TABLE "Job"
ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN "lockedAt" TIMESTAMP(3),
ADD COLUMN "lockToken" TEXT;

-- CreateIndex
CREATE INDEX "Job_status_lockedAt_idx" ON "Job"("status", "lockedAt");

-- CreateIndex
CREATE INDEX "Job_kind_userId_status_idx" ON "Job"("kind", "userId", "status");
