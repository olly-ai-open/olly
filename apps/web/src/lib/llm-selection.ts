import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithUserLLMSelection } from "@olly/core";

/**
 * Wrap a route handler so everything it does runs under the signed-in
 * user's LLM provider and model choice. Handlers still do their own auth;
 * this only establishes the selection context.
 */
export function withUserLLM<Args extends unknown[], R>(
  handler: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
  return async (...args: Args) => {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) return handler(...args);
    return runWithUserLLMSelection(prisma, userId, () => handler(...args));
  };
}
