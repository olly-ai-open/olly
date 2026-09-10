-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "meetingBufferMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "minSchedulingNoticeHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "workingDays" JSONB,
ADD COLUMN     "workingHoursEnd" TEXT,
ADD COLUMN     "workingHoursStart" TEXT;

-- CreateTable
CREATE TABLE "SchedulingRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "constraints" JSONB,
    "proposedSlots" JSONB,
    "round" INTEGER NOT NULL DEFAULT 0,
    "gmailThreadId" TEXT,
    "referenceToken" TEXT NOT NULL,
    "autoBook" BOOLEAN NOT NULL DEFAULT true,
    "bookedEventId" TEXT,
    "bookedSlot" JSONB,
    "attentionReason" TEXT,
    "lastPolledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchedulingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulingAttendee" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "personId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "responseStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "parsedAvailability" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchedulingAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulingMessage" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "gmailMessageId" TEXT,
    "fromEmail" TEXT,
    "snippet" TEXT,
    "parsedIntent" JSONB,
    "round" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchedulingMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SchedulingRequest_referenceToken_key" ON "SchedulingRequest"("referenceToken");

-- CreateIndex
CREATE INDEX "SchedulingRequest_userId_status_idx" ON "SchedulingRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "SchedulingRequest_status_updatedAt_idx" ON "SchedulingRequest"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulingAttendee_requestId_email_key" ON "SchedulingAttendee"("requestId", "email");

-- CreateIndex
CREATE INDEX "SchedulingMessage_requestId_createdAt_idx" ON "SchedulingMessage"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulingMessage_requestId_gmailMessageId_key" ON "SchedulingMessage"("requestId", "gmailMessageId");

-- AddForeignKey
ALTER TABLE "SchedulingRequest" ADD CONSTRAINT "SchedulingRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingAttendee" ADD CONSTRAINT "SchedulingAttendee_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SchedulingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingAttendee" ADD CONSTRAINT "SchedulingAttendee_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingMessage" ADD CONSTRAINT "SchedulingMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SchedulingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

