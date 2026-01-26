-- CreateTable
CREATE TABLE "DocGenRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "intent" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" JSONB,
    "templateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocGenRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocGenRun" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "evidence" JSONB,
    "findings" JSONB,
    "error" TEXT,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DocGenRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedDocument" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "citations" JSONB,
    "openQuestions" JSONB,
    "format" TEXT NOT NULL DEFAULT 'markdown',
    "savedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "docType" TEXT NOT NULL,
    "templateSource" TEXT NOT NULL DEFAULT 'system',
    "content" TEXT NOT NULL,
    "structure" JSONB,
    "mimeType" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocGenRequest_userId_status_idx" ON "DocGenRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "DocGenRequest_createdAt_idx" ON "DocGenRequest"("createdAt");

-- CreateIndex
CREATE INDEX "DocGenRun_requestId_stage_idx" ON "DocGenRun"("requestId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedDocument_requestId_key" ON "GeneratedDocument"("requestId");

-- CreateIndex
CREATE INDEX "GeneratedDocument_userId_docType_idx" ON "GeneratedDocument"("userId", "docType");

-- CreateIndex
CREATE INDEX "GeneratedDocument_createdAt_idx" ON "GeneratedDocument"("createdAt");

-- CreateIndex
CREATE INDEX "TemplateProfile_userId_docType_isActive_idx" ON "TemplateProfile"("userId", "docType", "isActive");

-- AddForeignKey
ALTER TABLE "DocGenRequest" ADD CONSTRAINT "DocGenRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocGenRequest" ADD CONSTRAINT "DocGenRequest_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TemplateProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocGenRun" ADD CONSTRAINT "DocGenRun_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "DocGenRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "DocGenRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateProfile" ADD CONSTRAINT "TemplateProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
