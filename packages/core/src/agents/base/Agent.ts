import { ToolLoopAgent, Output, stepCountIs, type LanguageModel } from 'ai';
import type { z } from 'zod';
import { AgentMemory, InMemoryAgentMemory } from './Memory';
import { OllyTool, ToolContext, toAITool } from './Tool';
import { wrapLanguageModel } from 'ai';
import { devToolsMiddleware } from '@ai-sdk/devtools';
import { startLangfuseObservation, withLangfuseTrace } from '../../telemetry/langfuse';
import { recordAgentAggregate } from '../../telemetry/metrics-aggregates';
import {
  buildProviderOptions,
  createLanguageModel,
  getLLMEffort,
  getLLMTemperature,
  type LLMProvider,
} from '../../llm';

/**
 * Message type for conversation history
 */
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  name: string;
  description: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  tools?: OllyTool[];
  memory?: AgentMemory;
  maxToolRoundtrips?: number;
  telemetryEnabled?: boolean;
  /**
   * When set, every execute() call returns `output` parsed and validated
   * against this schema via the provider's structured-output mode. Keep it
   * strict-compatible: all keys required, nullable instead of optional.
   */
  outputSchema?: z.ZodTypeAny;
}

/**
 * Agent execution result
 */
export interface AgentResult {
  text: string;
  /** Structured result when the agent (or this call) has an output schema. */
  output?: unknown;
  toolCalls?: Array<{
    toolName: string;
    args: any;
    result: any;
  }>;
  metadata?: Record<string, any>;
}

/**
 * Base Agent class for all Olly agents
 */
export abstract class BaseAgent {
  protected name: string;
  protected description: string;
  protected model: string;
  protected provider: LLMProvider;
  protected languageModel: LanguageModel;
  protected outputSchema?: z.ZodTypeAny;
  protected temperature: number;
  protected maxTokens: number;
  protected maxToolRoundtrips: number;
  protected systemPrompt: string;
  protected tools: Map<string, OllyTool>;
  protected memory: AgentMemory;
  protected telemetryEnabled: boolean;

  constructor(config: AgentConfig) {
    this.name = config.name;
    this.description = config.description;
    this.temperature = config.temperature || getLLMTemperature();
    this.maxTokens = config.maxTokens ?? 2000;
    this.maxToolRoundtrips = config.maxToolRoundtrips ?? 5;
    this.systemPrompt = config.systemPrompt || this.getDefaultSystemPrompt();
    this.memory = config.memory || new InMemoryAgentMemory();
    this.telemetryEnabled = config.telemetryEnabled ?? true;
    this.outputSchema = config.outputSchema;

    // Initialize language model using provider factory
    const { model, provider, modelName } = createLanguageModel(config.model);
    this.model = modelName;
    this.provider = provider;
    this.languageModel = model;

    const DEBUG_AI_SDK = process.env.DEBUG_AI_SDK === 'true';
    if (DEBUG_AI_SDK) {
      this.languageModel = wrapLanguageModel({
        model,
        middleware: devToolsMiddleware(),
      });
    }

    this.tools = new Map();
    if (config.tools) {
      config.tools.forEach(tool => {
        this.registerTool(tool);
      });
    }

  }
  
  /**
   * Get default system prompt for the agent
   */
  protected abstract getDefaultSystemPrompt(): string;
  
  /**
   * Register a tool with the agent
   */
  registerTool(tool: OllyTool): void {
    this.tools.set(tool.name, tool);
  }


  /**
   * Get tools formatted for AI SDK with proper context
   */
  protected getAITools(context: ToolContext) {
    const aiTools: Record<string, any> = {};
    this.tools.forEach((tool, name) => {
      aiTools[name] = toAITool(tool, context);
    });
    return aiTools;
  }
  
  
  /**
   * Execute the agent with a given prompt
   */
  async execute(
    prompt: string,
    context?: ToolContext,
    options?: {
      /** Override the agent's output schema for this call; null disables it. */
      outputSchema?: z.ZodTypeAny | null;
    },
  ): Promise<AgentResult> {
    const baseContext = context || {
      userId: 'system',
      sessionId: `session-${Date.now()}`,
    };
    const toolContext: ToolContext = {
      ...baseContext,
      telemetryEnabled: this.telemetryEnabled,
      metadata: {
        ...(baseContext.metadata || {}),
        agentName: this.name,
      },
    };
    
    // Load memory before execution
    await this.memory.load();
    
    // Add conversation history to prompt if available
    const history = this.memory.getShortTerm<Message[]>('conversationHistory');
    let fullPrompt = prompt;
    
    if (history && history.length > 0) {
      const contextPrompt = `Previous conversation context:\n${history
        .slice(-5) // Last 5 messages
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n')}\n\nCurrent request: ${prompt}`;
      fullPrompt = contextPrompt;
    }
    
    // Create ToolLoopAgent with proper context for this execution
    const tools = this.getAITools(toolContext);
    const outputSchema =
      options?.outputSchema === null ? undefined : (options?.outputSchema ?? this.outputSchema);
    const agent = new ToolLoopAgent({
      model: this.languageModel,
      instructions: this.systemPrompt,
      tools,
      experimental_telemetry: {
        isEnabled: true,
      },
      stopWhen: stepCountIs(this.maxToolRoundtrips),
      providerOptions: buildProviderOptions(this.provider, this.model, getLLMEffort()),
      ...(outputSchema && { output: Output.object({ schema: outputSchema }) }),
    } as any);
    
    // Execute using ToolLoopAgent
    const startedAt = Date.now();
    try {
      const result = await withLangfuseTrace(
        {
          name: this.name,
          userId: toolContext.userId,
          sessionId: toolContext.sessionId,
          input: fullPrompt,
          metadata: {
            agent: this.name,
            model: this.model,
          },
          enabled: this.telemetryEnabled,
        },
        async (span) => {
          const generation = startLangfuseObservation({
            name: `${this.name} generation`,
            input: [{ role: 'user', content: fullPrompt }],
            metadata: { agent: this.name },
            model: this.model,
            asType: 'generation',
            enabled: this.telemetryEnabled,
          });
          const response = await agent.generate({
            prompt: fullPrompt,
          });
          const usage = extractUsage(response);
          generation?.update({
            output: response.text,
            usageDetails: formatUsageDetails(usage),
          });
          generation?.end();
          span?.update({ output: response.text });
          span?.end();
          return response;
        },
      );

      const durationMs = Date.now() - startedAt;
      const usage = extractUsage(result);

      await recordAgentAggregate({
        agentName: this.name,
        durationMs,
        success: true,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
      });

      // Process and store results in memory
      await this.processResult(result);
      
      // Save memory after execution
      await this.memory.save();
      
      // Extract tool calls from steps
      const toolCalls = result.steps
        ?.filter((step: any) => step.type === 'tool-call')
        ?.map((step: any) => ({
          toolName: step.toolName || step.tool?.name,
          args: step.args || step.tool?.args || {},
          result: step.result || null,
        })) || [];
      
      return {
        text: result.text,
        output: outputSchema ? (result as any).output : undefined,
        toolCalls,
        metadata: {
          steps: result.steps,
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      await recordAgentAggregate({
        agentName: this.name,
        durationMs,
        success: false,
      });
      throw error;
    }
  }
   
  /**
   * Process the result and update memory
   */
  protected async processResult(result: any): Promise<void> {
    // Store the last response in short-term memory
    this.memory.setShortTerm('lastResponse', result.text);
    
    // Store tool call results if any
    if (result.toolCalls && result.toolCalls.length > 0) {
      this.memory.setShortTerm('lastToolCalls', result.toolCalls);
    }
    
    // Update conversation history
    const history = this.memory.getShortTerm<Message[]>('conversationHistory') || [];
    
    // Keep last 10 messages
    if (history.length > 10) {
      history.splice(0, history.length - 10);
    }
    
    // Add the assistant's response to history
    history.push({
      role: 'assistant',
      content: result.text,
    });
    
    this.memory.setShortTerm('conversationHistory', history);
  }
  
  /**
   * Clear the agent's short-term memory
   */
  clearShortTermMemory(): void {
    this.memory.clearShortTerm();
  }
  
  /**
   * Clear the agent's long-term memory
   */
  clearLongTermMemory(): void {
    this.memory.clearLongTerm();
  }
  
  /**
   * Add a message to conversation history
   */
  addToHistory(message: Message): void {
    const history = this.memory.getShortTerm<Message[]>('conversationHistory') || [];
    history.push(message);
    
    // Keep last 10 messages
    if (history.length > 10) {
      history.splice(0, history.length - 10);
    }
    
    this.memory.setShortTerm('conversationHistory', history);
  }

  /**
   * Build messages array with system prompt and context
   */
  protected buildMessages(prompt: string): Message[] {
    const messages: Message[] = [
      { 
        role: 'system', 
        content: this.systemPrompt 
      },
    ];
    
    // Add context from memory if available
    const context = this.memory.getShortTerm('context');
    if (context) {
      messages.push({
        role: 'system',
        content: `Context from previous interactions: ${JSON.stringify(context)}`,
      });
    }
    
    // Add conversation history from memory if available
    const history = this.memory.getShortTerm<Message[]>('conversationHistory');
    if (history && Array.isArray(history)) {
      messages.push(...history);
    }
    
    messages.push({ 
      role: 'user', 
      content: prompt 
    });
    
    return messages;
  }
}

function extractUsage(result: any): {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
} {
  const usage =
    result?.usage ||
    result?.response?.usage ||
    result?.raw?.usage ||
    result?.metadata?.usage;

  if (!usage || typeof usage !== 'object') return {};
  return {
    promptTokens: usage.promptTokens ?? usage.prompt_tokens ?? usage.input_tokens,
    completionTokens:
      usage.completionTokens ??
      usage.completion_tokens ??
      usage.output_tokens,
    totalTokens: usage.totalTokens ?? usage.total_tokens ?? usage.total,
  };
}

function formatUsageDetails(usage: {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}) {
  if (!usage.promptTokens && !usage.completionTokens && !usage.totalTokens) {
    return undefined;
  }
  return {
    input: usage.promptTokens ?? 0,
    output: usage.completionTokens ?? 0,
    total:
      usage.totalTokens ??
      (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0),
  };
}
