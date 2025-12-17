-- CreateTable
CREATE TABLE "ActionItemEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionItemId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionItemEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActionItemEvent_userId_type_createdAt_idx" ON "ActionItemEvent"("userId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "ActionItemEvent_actionItemId_createdAt_idx" ON "ActionItemEvent"("actionItemId", "createdAt");

-- AddForeignKey
ALTER TABLE "ActionItemEvent" ADD CONSTRAINT "ActionItemEvent_actionItemId_fkey" FOREIGN KEY ("actionItemId") REFERENCES "ActionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
