import { getPrisma } from "../prisma-server";

type AgentAggregateInput = {
  agentName: string;
  durationMs: number;
  success: boolean;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  day?: Date;
};

type ToolAggregateInput = {
  toolName: string;
  operation: string;
  durationMs: number;
  success: boolean;
  day?: Date;
};

function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function isEnabled(): boolean {
  return process.env.METRICS_AGGREGATES_ENABLED !== "false";
}

function toUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function recordAgentAggregate(input: AgentAggregateInput): Promise<void> {
  if (!isEnabled() || !hasDatabase()) return;
  const prisma = await getPrisma();
  const day = toUtcDay(input.day ?? new Date());
  const promptTokens = input.promptTokens ?? 0;
  const completionTokens = input.completionTokens ?? 0;
  const totalTokens = input.totalTokens ?? promptTokens + completionTokens;
  const successes = input.success ? 1 : 0;
  const errors = input.success ? 0 : 1;

  try {
    await prisma.agentMetricsDaily.upsert({
      where: {
        day_agentName: {
          day,
          agentName: input.agentName,
        },
      },
      update: {
        runs: { increment: 1 },
        successes: { increment: successes },
        errors: { increment: errors },
        totalDurationMs: { increment: Math.round(input.durationMs) },
        promptTokens: { increment: promptTokens },
        completionTokens: { increment: completionTokens },
        totalTokens: { increment: totalTokens },
      },
      create: {
        day,
        agentName: input.agentName,
        runs: 1,
        successes,
        errors,
        totalDurationMs: Math.round(input.durationMs),
        promptTokens,
        completionTokens,
        totalTokens,
      },
    });
  } catch (error) {
    console.warn("Failed to record agent metrics aggregate", error);
  }
}

export async function recordToolAggregate(input: ToolAggregateInput): Promise<void> {
  if (!isEnabled() || !hasDatabase()) return;
  const prisma = await getPrisma();
  const day = toUtcDay(input.day ?? new Date());
  const successes = input.success ? 1 : 0;
  const errors = input.success ? 0 : 1;

  try {
    await prisma.toolMetricsDaily.upsert({
      where: {
        day_toolName_operation: {
          day,
          toolName: input.toolName,
          operation: input.operation,
        },
      },
      update: {
        calls: { increment: 1 },
        successes: { increment: successes },
        errors: { increment: errors },
        totalDurationMs: { increment: Math.round(input.durationMs) },
      },
      create: {
        day,
        toolName: input.toolName,
        operation: input.operation,
        calls: 1,
        successes,
        errors,
        totalDurationMs: Math.round(input.durationMs),
      },
    });
  } catch (error) {
    console.warn("Failed to record tool metrics aggregate", error);
  }
}
