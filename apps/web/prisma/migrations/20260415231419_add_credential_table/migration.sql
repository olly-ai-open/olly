-- CreateTable
CREATE TABLE "AirtableCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AirtableCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JiraCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JiraCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AirtableCredential_userId_key" ON "AirtableCredential"("userId");

-- CreateIndex
CREATE INDEX "AirtableCredential_userId_idx" ON "AirtableCredential"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "JiraCredential_userId_key" ON "JiraCredential"("userId");

-- CreateIndex
CREATE INDEX "JiraCredential_userId_idx" ON "JiraCredential"("userId");

-- CreateIndex
CREATE INDEX "Credential_userId_provider_idx" ON "Credential"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_userId_provider_key" ON "Credential"("userId", "provider");

-- AddForeignKey
ALTER TABLE "AirtableCredential" ADD CONSTRAINT "AirtableCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JiraCredential" ADD CONSTRAINT "JiraCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
