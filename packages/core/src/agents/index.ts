// Base classes
export { BaseAgent, type AgentConfig, type AgentResult } from './base/Agent';
export { BaseTool, type OllyTool, type ToolContext, toAITool } from './base/Tool';
export { 
  type AgentMemory, 
  InMemoryAgentMemory,
  type UserPreferences,
  type MeetingPatterns 
} from './base/Memory';

// Tools
export { CalendarTool } from './tools/CalendarTool';
export { EmailTool } from './tools/EmailTool';
export { DriveTool } from './tools/DriveTool';

// Agent Personas
export { MeetingPrepAgent } from './personas/MeetingPrepAgent';
export {
  parseSchedulingDirection,
  draftSchedulingEmailBody,
  parseSchedulingReply,
  formatSlotForEmail,
  type ParsedSchedulingDirection,
  type ParsedSchedulingReply,
} from './personas/SchedulingAgent';
export { MorningBriefAgent } from './personas/MorningBriefAgent';
export { EndOfDayBriefAgent } from './personas/EndOfDayBriefAgent';
export {
  DocGenAgent,
  type DocType,
  type DocGenIntent,
  type Evidence,
  type DocSection,
  type GeneratedDocResult,
  type ProgressCallback,
} from './personas/DocGenAgent';
