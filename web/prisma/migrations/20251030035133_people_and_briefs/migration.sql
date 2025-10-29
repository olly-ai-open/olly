-- AlterTable
ALTER TABLE "ActionItem" ADD COLUMN     "briefId" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Brief" ADD COLUMN     "readAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "title" TEXT,
    "org" TEXT,
    "avatarUrl" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingParticipant" (
    "meetingId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" TEXT,
    "status" TEXT,

    CONSTRAINT "MeetingParticipant_pkey" PRIMARY KEY ("meetingId","personId")
);

-- CreateTable
CREATE TABLE "BriefParticipant" (
    "briefId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,

    CONSTRAINT "BriefParticipant_pkey" PRIMARY KEY ("briefId","personId")
);

-- CreateTable
CREATE TABLE "ActionItemAssignee" (
    "actionItemId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,

    CONSTRAINT "ActionItemAssignee_pkey" PRIMARY KEY ("actionItemId","personId")
);

-- CreateIndex
CREATE INDEX "Person_userId_email_idx" ON "Person"("userId", "email");

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "Brief"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefParticipant" ADD CONSTRAINT "BriefParticipant_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "Brief"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefParticipant" ADD CONSTRAINT "BriefParticipant_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItemAssignee" ADD CONSTRAINT "ActionItemAssignee_actionItemId_fkey" FOREIGN KEY ("actionItemId") REFERENCES "ActionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItemAssignee" ADD CONSTRAINT "ActionItemAssignee_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
