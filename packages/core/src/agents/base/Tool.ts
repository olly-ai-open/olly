import { z } from 'zod';
import { tool } from 'ai';

/**
 * Context passed to tool execution
 */
export interface ToolContext {
  userId: string;
  sessionId?: string;
  metadata?: Record<string, any>;
}

/**
 * Base interface for all Olly tools
 */
export interface OllyTool<TInput = any, TOutput = any> {
  name: string;
  description: string;
  parameters: z.ZodType<any>;
  execute: (input: TInput, context: ToolContext) => Promise<TOutput>;
}

/**
 * Convert OllyTool to Vercel AI SDK tool format
 */
export function toAITool<TInput, TOutput>(
  ollyTool: OllyTool<TInput, TOutput>,
  context: ToolContext
): any {
  return tool({
    description: ollyTool.description,
    inputSchema: ollyTool.parameters,
    execute: async (args: any) => {
      return ollyTool.execute(args as TInput, context);
    },
  } as any);
}

/**
 * Base class for implementing tools
 */
export abstract class BaseTool<TInput = any, TOutput = any> 
  implements OllyTool<TInput, TOutput> {
  abstract name: string;
  abstract description: string;
  abstract parameters: z.ZodType<any>;
  abstract execute(input: TInput, context: ToolContext): Promise<TOutput>;
  
  /**
   * Convert this tool to AI SDK format
   */
  toAITool(context: ToolContext) {
    return toAITool(this, context);
  }
}