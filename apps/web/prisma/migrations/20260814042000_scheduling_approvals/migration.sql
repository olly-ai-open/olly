-- AlterTable
ALTER TABLE "SchedulingRequest" ADD COLUMN     "autoAltDates" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoAltTimes" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pendingSlots" JSONB;

