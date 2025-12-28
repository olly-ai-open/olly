import { BaseAgent, AgentConfig } from '../base/Agent';
import { CalendarTool } from '../tools/CalendarTool';
import { EmailTool } from '../tools/EmailTool';
import { DriveTool } from '../tools/DriveTool';
import { SlackTool } from '../tools/SlackTool';
import { MEETING_BRIEF_PROMPT } from '../../prompts/meetingBriefPrompt';

/**
 * MeetingPrepAgent - Proactively prepares briefs for upcoming meetings
 * 
 * This agent:
 * 1. Identifies upcoming meetings
 * 2. Gathers relevant context from email, drive, calendar, and slack.
 * 3. Generates comprehensive meeting briefs
 * 4. Learns from user preferences over time
 */
export class MeetingPrepAgent extends BaseAgent {
  constructor(config?: Partial<AgentConfig>) {
    super({
      name: 'MeetingPrepAgent',
      description: 'Prepares comprehensive briefs for upcoming meetings by gathering context from multiple sources',
      ...config,
      tools: [
        new CalendarTool(),
        new EmailTool(),
        new DriveTool(),
        new SlackTool(),
        ...(config?.tools || []),
      ],
      systemPrompt: `${config?.systemPrompt || MEETING_BRIEF_PROMPT}}\n\nStrict output format:
        - Return ONLY a single MINIFIED JSON object with these keys:
        {
          \"brief_markdown\": string, // full report as markdown in the format above (<= 1 page)
          \"goals\": [                // optional, high-level meeting goals
            string                   // short, non-assignable goal statements
          ],
          \"key_context\": string [],  // a list of up to 3 key context points
          \"sources\": [              // list of INDIVIDUAL sources used to generate the brief
            {
              \"type\": \"email\" | \"drive\" | \"slack\" | \"calendar\",
              \"title\": string,      // e.g. email subject, doc name, channel name, meeting title
              \"url\": string         // link to the source if available
            }
          ]
        }
        - No code fences. No commentary outside the JSON.
        - For sources, list EACH INDIVIDUAL item (email, document, message, event) separately.
        - Do NOT group sources together (e.g., don't say "Recent emails to X", instead list each email).
        - For emails: use the email subject as title and the message URL.
        - For documents: use the document name as title and the webViewLink.
        - For Slack: use the message text snippet or channel name as title and the permalink.
        - For calendar: use the event title/summary and the event URL.
        
        Example sources format:
        \"sources\": [
          {\"type\": \"calendar\", \"title\": \"Q4 Planning Meeting\", \"url\": \"https://calendar.google.com/...\"},
          {\"type\": \"email\", \"title\": \"Re: Q4 Budget Proposal\", \"url\": \"https://mail.google.com/mail/u/0/#all/abc123\"},
          {\"type\": \"email\", \"title\": \"Meeting Agenda - Q4 Planning\", \"url\": \"https://mail.google.com/mail/u/0/#all/def456\"},
          {\"type\": \"drive\", \"title\": \"Q4 Strategy Deck.pptx\", \"url\": \"https://docs.google.com/presentation/d/...\"},
          {\"type\": \"slack\", \"title\": \"Discussion about Q4 metrics in #planning\", \"url\": \"https://company.slack.com/archives/...\"}
        ]`
    });
  }
  
  protected getDefaultSystemPrompt(): string {
    return MEETING_BRIEF_PROMPT;
  }
  
  /**
   * Prepare a brief for a specific meeting
   */
  async prepareMeetingBrief(
    meetingId: string, 
    userId: string,
    options?: {
      token?: string;
      debugContext?: {
        debugData?: any;
        addTimelineEntry?: (action: string, details?: any) => void;
      };
      searchTimeframeDays?: number;
    }
  ): Promise<string> {
    const { debugContext, searchTimeframeDays = 30 } = options || {};

    // Add timeline entry if debug context is provided
    if (debugContext?.addTimelineEntry) {
      debugContext.addTimelineEntry('AGENT_PREPARING_BRIEF', { meetingId, userId });
    }
    
    const prompt = `Prepare a comprehensive brief for meeting ID: ${meetingId}.
    
Steps:
1. First, get the meeting details using the calendar tool
2. Search for relevant emails from/to the attendees in the past ${searchTimeframeDays} days
3. Search for relevant documents in Drive related to the meeting topic or attendees
4. Search for relevant conversations in Slack related to the meeting topic or attendees
5. Synthesize all information into a concise, actionable brief

Important: As you gather information:
- Track EVERY individual email, document, Slack message, and calendar event you find
- For each item, note its title/subject and URL for the sources list
- When emails are returned, extract subject and url from EACH message
- When documents are returned, extract name and webViewLink from EACH file
- When Slack messages are returned, extract text/channel and permalink from EACH message

Focus on:
- What's the purpose of this meeting?
- What context do I need to be prepared?
- What are the key discussion points?
- Are there any action items or decisions needed?`;
    
    const result = await this.execute(prompt, { userId, sessionId: `meeting-${meetingId}` });
    
    // Log tool calls to debug context if provided
    if (debugContext?.addTimelineEntry && result.toolCalls) {
      debugContext.addTimelineEntry('AGENT_TOOL_CALLS', {
        toolsUsed: result.toolCalls.map(tc => tc.toolName),
        toolCallCount: result.toolCalls.length
      });
      
      // Add detailed tool call information to debug data
      if (debugContext.debugData) {
        debugContext.debugData.agentToolCalls = result.toolCalls.map(tc => ({
          tool: tc.toolName,
          args: tc.args,
          hasResult: !!tc.result
        }));
      }
    }
    
    // Parse the JSON response and add debug data
    try {
      const parsedResult = JSON.parse(result.text);
      
      if (debugContext?.debugData) {
        // Add sources to debug data
        if (parsedResult.sources) {
          debugContext.debugData.sources = parsedResult.sources;
        }
        
        // Add agent metadata
        debugContext.debugData.agentMetadata = {
          model: this.model,
          temperature: this.temperature,
          maxToolRoundtrips: this.maxToolRoundtrips,
          executionSteps: result.metadata?.steps?.length || 0
        };
      }
      
      if (debugContext?.addTimelineEntry) {
        debugContext.addTimelineEntry('AGENT_BRIEF_GENERATED', {
          sourcesCount: parsedResult.sources?.length || 0,
          goalsCount: parsedResult.goals?.length || 0,
          keyContextCount: parsedResult.key_context?.length || 0
        });
      }
    } catch (e) {
      // If parsing fails, log the error but continue
      if (debugContext?.addTimelineEntry) {
        debugContext.addTimelineEntry('AGENT_PARSE_ERROR', { 
          error: e instanceof Error ? e.message : 'Unknown error'
        });
      }
    }
    
    // Store the brief in memory for future reference
    this.memory.setLongTerm(`brief-${meetingId}`, result.text);
    
    return result.text;
  }
  
  /**
   * Learn from user feedback on a brief
   */
  async learnFromFeedback(
    meetingId: string,
    feedback: {
      helpful: boolean;
      tooLong?: boolean;
      missingInfo?: string;
      irrelevantInfo?: string;
    }
  ): Promise<void> {
    // Store feedback in long-term memory
    const existingFeedback = this.memory.getLongTerm('feedback') || [];
    existingFeedback.push({
      meetingId,
      timestamp: new Date().toISOString(),
      ...feedback,
    });
    this.memory.setLongTerm('feedback', existingFeedback);
    
    // Adjust preferences based on feedback patterns
    if (existingFeedback.length >= 5) {
      const recentFeedback = existingFeedback.slice(-10);
      const tooLongCount = recentFeedback.filter((f: any) => f.tooLong).length;
      
      if (tooLongCount > 5) {
        // User prefers shorter briefs
        this.memory.setLongTerm('briefStyle', 'concise');
      }
    }
    
    await this.memory.save();
  }
  
  /**
   * Get personalized system prompt based on learned preferences
   */
  protected buildMessages(prompt: string): any[] {
    const messages = super.buildMessages(prompt);
    
    // Add user preferences from memory
    const briefStyle = this.memory.getLongTerm('briefStyle');
    if (briefStyle) {
      messages.push({
        role: 'system',
        content: `User preference: Generate ${briefStyle} briefs.`,
      });
    }
    
    // Add recent feedback context
    const feedback = this.memory.getLongTerm('feedback');
    if (feedback && feedback.length > 0) {
      const recentFeedback = feedback.slice(-3);
      messages.push({
        role: 'system',
        content: `Recent user feedback: ${JSON.stringify(recentFeedback)}`,
      });
    }
    
    return messages;
  }
  
  /**
   * Parse briefs from unstructured content
   * In production, we'd use structured output from the LLM
   */
  private parseBriefsFromContent(content: string): Array<{
    meetingId: string;
    title: string;
    brief: string;
  }> {
    // This is a placeholder - in reality, we'd have the LLM return structured JSON
    // or use a more sophisticated parsing approach
    
    const briefs: Array<{ meetingId: string; title: string; brief: string }> = [];
    
    // Simple parsing logic - would be replaced with proper implementation
    const sections = content.split(/Meeting Brief:/gi);
    for (const section of sections.slice(1)) {
      const lines = section.trim().split('\n');
      if (lines.length > 0) {
        const title = lines[0].trim();
        const brief = lines.slice(1).join('\n').trim();
        briefs.push({
          meetingId: `meeting-${Date.now()}-${Math.random()}`,
          title,
          brief,
        });
      }
    }
    
    return briefs;
  }
}