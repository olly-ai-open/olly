import { createOpenAI } from '@ai-sdk/openai';
import { ToolLoopAgent, stepCountIs } from 'ai';
import { AgentMemory, InMemoryAgentMemory } from './Memory';
import { OllyTool, ToolContext, toAITool } from './Tool';
import { wrapLanguageModel } from 'ai';
import { devToolsMiddleware } from '@ai-sdk/devtools';

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
}

/**
 * Agent execution result
 */
export interface AgentResult {
  text: string;
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
  protected languageModel: ReturnType<typeof wrapLanguageModel>;
  protected temperature: number;
  protected maxTokens: number;
  protected maxToolRoundtrips: number;
  protected systemPrompt: string;
  protected tools: Map<string, OllyTool>;
  protected memory: AgentMemory;
  protected openai: ReturnType<typeof createOpenAI>;
  
  constructor(config: AgentConfig) {
    this.name = config.name;
    this.description = config.description;
    this.model = config.model || process.env.OPENAI_MODEL || 'gpt-4-turbo';
    this.temperature = config.temperature || parseFloat(process.env.OPENAI_TEMPERATURE ?? "0.2");
    this.maxTokens = config.maxTokens ?? 2000;
    this.maxToolRoundtrips = config.maxToolRoundtrips ?? 5;
    this.systemPrompt = config.systemPrompt || this.getDefaultSystemPrompt();
    this.memory = config.memory || new InMemoryAgentMemory();
    
    // Initialize OpenAI provider
    this.openai = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.languageModel = this.openai(this.model);

    const DEBUG_AI_SDK = true;
    if (DEBUG_AI_SDK) {
      this.languageModel = wrapLanguageModel({
        model: this.openai(this.model),
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
  async execute(prompt: string, context?: ToolContext): Promise<AgentResult> {
    const toolContext = context || {
      userId: 'system',
      sessionId: `session-${Date.now()}`,
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
    const agent = new ToolLoopAgent({
      model: this.languageModel,
      instructions: this.systemPrompt,
      tools,
      stopWhen: stepCountIs(this.maxToolRoundtrips),
    });
    
    // Execute using ToolLoopAgent
    const result = await agent.generate({
      prompt: fullPrompt,
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
      toolCalls,
      metadata: {
        steps: result.steps,
      },
    };
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