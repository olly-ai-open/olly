-- CreateTable
CREATE TABLE "AgentMetricsDaily" (
    "id" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "agentName" TEXT NOT NULL,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "successes" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "totalDurationMs" INTEGER NOT NULL DEFAULT 0,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMetricsDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolMetricsDaily" (
    "id" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "toolName" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "successes" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "totalDurationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolMetricsDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentMetricsDaily_day_idx" ON "AgentMetricsDaily"("day");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMetricsDaily_day_agentName_key" ON "AgentMetricsDaily"("day", "agentName");

-- CreateIndex
CREATE INDEX "ToolMetricsDaily_day_idx" ON "ToolMetricsDaily"("day");

-- CreateIndex
CREATE UNIQUE INDEX "ToolMetricsDaily_day_toolName_operation_key" ON "ToolMetricsDaily"("day", "toolName", "operation");
