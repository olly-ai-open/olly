-- CreateTable
CREATE TABLE "NotionCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workspaceName" TEXT,
    "botId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotionCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotionCredential_userId_key" ON "NotionCredential"("userId");

-- CreateIndex
CREATE INDEX "NotionCredential_userId_idx" ON "NotionCredential"("userId");

-- AddForeignKey
ALTER TABLE "NotionCredential" ADD CONSTRAINT "NotionCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
