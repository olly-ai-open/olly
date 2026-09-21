import { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaClient } from "@prisma/client";
import type { LLMEffort, LLMProvider } from "./llm";

/**
 * Per-request LLM selection.
 *
 * Provider and model are chosen per user in Settings, but the code that
 * builds models reads configuration from module-level helpers in many
 * places. Rather than thread a selection through every call, the entry
 * points (API routes and the job worker) run their work inside
 * `runWithLLMSelection`, and `getLLMProvider` / `getLLMModel` consult the
 * active selection before falling back to environment variables.
 *
 * API keys always come from the environment: the deployment operator's
 * keys on a server, the user's own key on the desktop app.
 */
export type LLMSelection = {
  provider?: LLMProvider | null;
  model?: string | null;
  effort?: LLMEffort | null;
};

const storage = new AsyncLocalStorage<LLMSelection>();

export function getLLMSelection(): LLMSelection | undefined {
  return storage.getStore();
}

export function runWithLLMSelection<T>(
  selection: LLMSelection,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(selection, fn);
}

/** Load the user's saved selection and run `fn` under it. */
export async function runWithUserLLMSelection<T>(
  prisma: PrismaClient,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  let selection: LLMSelection = {};
  try {
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { llmProvider: true, llmModel: true, llmEffort: true },
    });
    selection = {
      provider: (settings?.llmProvider as LLMProvider | null) ?? null,
      model: settings?.llmModel ?? null,
      effort: (settings?.llmEffort as LLMEffort | null) ?? null,
    };
  } catch {
    // Fall back to the deployment default rather than fail the request.
  }
  return runWithLLMSelection(selection, fn);
}
