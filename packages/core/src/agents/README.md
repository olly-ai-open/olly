# Olly Agent Framework

## Overview

The Olly Agent Framework transforms Olly from a reactive LLM system to a proactive, tool-equipped AI agent system. This framework enables Olly to autonomously gather context, make decisions, and take actions on behalf of users.

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
- Memory management (short-term and long-term)
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

- **Short-term memory**: Session-specific context
- **Long-term memory**: User preferences and learned patterns
- **Persistence**: Can be extended for database storage

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
OPENAI_MODEL=gpt-4.1-mini
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

## Benefits Over Legacy System

1. **Autonomous Context Gathering**: Agents can search multiple sources without explicit instructions
2. **Tool Composition**: Complex tasks can be broken down into tool calls
3. **Memory & Learning**: Agents remember user preferences and improve over time
4. **Parallel Execution**: Multiple tools can be executed concurrently
5. **Extensibility**: Easy to add new tools and agents
6. **Streaming Support**: Real-time responses for better UX

## Future Enhancements

- [ ] Add more agent personas (ActionTrackerAgent)
- [ ] Add persistent memory storage (database-backed)
- [ ] Create agent collaboration protocols
- [ ] Implement agent self-evaluation and improvement
- [ ] Add observability and monitoring
- [ ] Create agent testing framework
