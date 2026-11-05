# Olly Agent Framework

## Overview

The agent framework is a small set of classes for LLM calls that can use tools. An agent gets a system prompt and a list of tools (calendar, email, Drive, Slack, Notion), lets the model call those tools to gather context, and returns schema-validated JSON. The brief, document, and scheduling features are each one agent.

## Architecture

```
agents/
├── base/                   # Core abstractions
│   ├── Agent.ts            # Base agent class
│   ├── Tool.ts             # Tool interface
│   └── Memory.ts           # Memory management
├── tools/                  # Reusable tools
│   ├── CalendarTool.ts     # Google Calendar access
│   ├── EmailTool.ts        # Gmail search & retrieval
│   ├── DriveTool.ts        # Google Drive search
│   ├── SlackTool.ts        # Slack search & retrieval
│   └── NotionTool.ts       # Notion search, database queries, page content
└── personas/               # Agent personalities
    ├── MeetingPrepAgent.ts # Meeting preparation specialist
    ├── MorningBriefAgent.ts # Morning brief generator
    ├── EndOfDayBriefAgent.ts # End-of-day summary generator
    ├── DocGenAgent.ts      # Generates documents from connected sources
    └── SchedulingAgent.ts  # Negotiates meeting times over email
```

## Key Components

### 1. Base Agent

The `BaseAgent` class provides:
- Tool registration and execution
- In-process memory (see Memory System below)
- Streaming and non-streaming responses
- Integration with Vercel AI SDK

### 2. Tools

Tools give agents the ability to interact with external systems:

- **CalendarTool**: Access calendar events, search meetings, get attendees
- **EmailTool**: Search Gmail, retrieve threads, get attachments
- **DriveTool**: Search files, retrieve content, get metadata
- **SlackTool**: Search messages and channels the user can see
- **NotionTool**: Search pages, query databases, read page content

### 3. Agent Personas

Specialized agents for specific tasks:

- **MeetingPrepAgent**: Proactively prepares meeting briefs by gathering context from multiple sources
- **MorningBriefAgent**: Generates morning briefs with today's priorities
- **EndOfDayBriefAgent**: Summarizes recent work into an end-of-day brief
- **DocGenAgent**: Generates a document from the sources the user selects
- **SchedulingAgent**: Runs the email negotiation for meeting scheduling

### 4. Memory System

- **Short-term memory**: Context for one agent run
- **Long-term memory**: A second key-value store with the same lifetime
- **Persistence**: None. `InMemoryAgentMemory` keeps everything in process memory and loses it when the process ends.

## Usage

### Basic Agent Usage

```typescript
import { MeetingPrepAgent } from '@olly/core/src/agents';

const agent = new MeetingPrepAgent();
const brief = await agent.prepareMeetingBrief(meetingId, userId);
```

## Configuration

### Environment Variables

```bash
# Provider selection: openai | anthropic | gemini (see packages/core/src/llm.ts)
LLM_PROVIDER=openai
LLM_TEMPERATURE=0.2
OPENAI_API_KEY=your-key
OPENAI_MODEL=gpt-5.6-luna
# or ANTHROPIC_API_KEY + ANTHROPIC_MODEL, or GEMINI_API_KEY + GOOGLE_MODEL
```

## Creating New Agents

1. Extend the `BaseAgent` class:

```typescript
export class MyAgent extends BaseAgent {
  constructor() {
    super({
      name: 'MyAgent',
      description: 'My custom agent',
      tools: [/* your tools */],
    });
  }
  
  protected getDefaultSystemPrompt(): string {
    return "Your agent's system prompt...";
  }
}
```

2. Create custom tools:

```typescript
export class MyTool extends BaseTool {
  name = 'myTool';
  description = 'My custom tool';
  parameters = z.object({
    action: z.string(),
  });
  
  async execute(input, context) {
    // Tool implementation
  }
}
```

## Design goals

1. **Autonomous context gathering**: agents search multiple sources without explicit instructions
2. **Tool composition**: complex tasks break down into tool calls
3. **Memory**: short-term context per run; nothing is persisted
4. **Parallel execution**: independent tools can run concurrently
5. **Extensibility**: new tools and agents are small classes
6. **Structured output**: every persona returns parsed, schema-validated JSON

## Ideas not yet built

Olly is published as-is, so none of these are planned. They are listed for
anyone who forks the project and wants a starting point.

- Persistent, database-backed agent memory
- An action-tracker persona that follows up on commitments
- Agent tools for Jira and Airtable, which today connect but feed no brief
- An evaluation harness for agent output quality
