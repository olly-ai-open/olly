import { NotionTool } from '../tools/NotionTool';
import { BaseAgent, AgentConfig } from '../base/Agent';
import { CalendarTool } from '../tools/CalendarTool';
import { EmailTool } from '../tools/EmailTool';
import { DriveTool } from '../tools/DriveTool';
import { SlackTool } from '../tools/SlackTool';
import { MORNING_BRIEF_PROMPT } from '../../prompts/morningBriefPrompt';

/**
 * MorningBriefAgent - Generates comprehensive morning briefs with today's priorities
 * 
 * This agent:
 * 1. Gathers today's meetings and events
 * 2. Collects action items and tasks
 * 3. Searches for relevant context from email, drive, and slack
 * 4. Synthesizes a concise, actionable morning brief
 */
export class MorningBriefAgent extends BaseAgent {
  constructor(config?: Partial<AgentConfig>) {
    super({
      name: 'MorningBriefAgent',
      description: 'Generates comprehensive morning briefs with today\'s priorities and relevant context',
      ...config,
      tools: [
        new CalendarTool(),
        new EmailTool(),
        new DriveTool(),
        new SlackTool(),
	new NotionTool(),
        ...(config?.tools || []),
      ],
      systemPrompt: `${config?.systemPrompt || MORNING_BRIEF_PROMPT}\n\nStrict output format:
        - Return ONLY a single MINIFIED JSON object with these keys:
        {
          \"brief_markdown\": string,           // full morning brief as markdown (<= 1 page)
          \"highlighted_action_item_ids\": string[], // IDs of most important action items for today
          \"sources\": [                       // list of sources used to generate the brief
            {
              \"type\": \"email\" | \"drive\" | \"slack\" | \"calendar\" | \"notion\",
              \"title\": string,              // e.g. email subject, doc name, channel name, Notion page title
              \"url\": string                 // link to the source if available
            }
          ],
          \"key_meetings\": [                  // today's important meetings
            {
              \"id\": string,
              \"title\": string,
              \"time\": string,
              \"attendees\": string[],
              \"preparation_needed\": string  // what to prepare for this meeting
            }
          ]
        }
        - No code fences. No commentary outside the JSON.
        - For sources, list EACH INDIVIDUAL item separately.
        - Focus on what matters TODAY - be practical and actionable.
        - Prioritize items tied to today's meetings or urgent follow-ups.`
    });
  }
  
  protected getDefaultSystemPrompt(): string {
    return MORNING_BRIEF_PROMPT;
  }
  
  /**
   * Generate morning brief for a specific date
   */
  async generateMorningBrief(
    userId: string,
    options?: {
      date?: string;  // YYYY-MM-DD format, defaults to today
      timeZone?: string;
      actionItems?: Array<{
        id: string;
        title: string;
        dueAt?: string | null;
        status?: string | null;
      }>;
      searchTimeframeDays?: number;
    }
  ): Promise<string> {
    const { 
      date = new Date().toISOString().split('T')[0], 
      timeZone = 'UTC',
      actionItems = [],
      searchTimeframeDays = 7
    } = options || {};
    
    // Format action items for the prompt
    const actionItemsText = actionItems.length > 0
      ? actionItems.map(ai => 
          `- [${ai.id}] ${ai.title}${ai.dueAt ? ` (due: ${ai.dueAt})` : ''}${ai.status ? ` [${ai.status}]` : ''}`
        ).join('\n')
      : 'No action items';
    
    const prompt = `Generate a morning brief for ${date} (timezone: ${timeZone}).

Available Action Items:
${actionItemsText}

Steps:
1. Get today's calendar events using the calendar tool (for date: ${date})
2. Search for recent important emails from the past ${searchTimeframeDays} days that relate to today's meetings or action items
3. Search for relevant documents in Drive that might be needed for today's meetings
4. Check Slack for recent important messages or discussions related to today's activities
5. Search Notion (use the notion tool) for pages or databases related to today's meetings or action items
6. Synthesize all information into a concise, actionable morning brief

Important:
- Only use sources for tools that return results; skip any integration that isn't connected.
- Track EVERY individual source (email, document, Slack message, calendar event, Notion page)
- For each meeting today, identify what preparation is needed
- Highlight only the MOST important action items that should be addressed today
- Focus on practical, actionable insights for the day ahead
- Keep the brief concise - the reader is busy

Focus on answering:
- What are my priorities for today?
- What meetings do I have and what do I need to prepare?
- Are there urgent items that need attention?
- What context from recent communications is relevant for today?`;
    
    const result = await this.execute(prompt, { 
      userId, 
      sessionId: `morning-brief-${date}` 
    });
    
    
    // Store the brief in memory for future reference
    this.memory.setLongTerm(`morning-brief-${date}`, result.text);
    
    return result.text;
  }
  
  /**
   * Generate a quick morning summary (lighter version)
   */
  async generateQuickSummary(
    userId: string,
    options?: {
      date?: string;
      maxMeetings?: number;
      maxActionItems?: number;
    }
  ): Promise<string> {
    const { 
      date = new Date().toISOString().split('T')[0],
      maxMeetings = 3,
      maxActionItems = 5
    } = options || {};
    
    const prompt = `Generate a QUICK morning summary for ${date}.
    
Steps:
1. Get today's calendar events (limit to ${maxMeetings} most important)
2. Quickly scan for any urgent emails from today
3. Return a brief summary focusing ONLY on the essentials

Keep it extremely brief - just the highlights in 3-4 bullet points.`;
    
    const result = await this.execute(prompt, { 
      userId, 
      sessionId: `quick-summary-${date}` 
    });
    
    return result.text;
  }
  
  /**
   * Learn from user feedback on the morning brief
   */
  async learnFromFeedback(
    date: string,
    feedback: {
      helpful: boolean;
      tooLong?: boolean;
      missingInfo?: string;
      preferredSections?: string[];
    }
  ): Promise<void> {
    // Store feedback in long-term memory
    const existingFeedback = this.memory.getLongTerm<any[]>('morning-brief-feedback') || [];
    existingFeedback.push({
      date,
      timestamp: new Date().toISOString(),
      ...feedback
    });
    
    // Keep only last 30 feedback entries
    if (existingFeedback.length > 30) {
      this.memory.setLongTerm('morning-brief-feedback', existingFeedback.slice(-30));
    } else {
      this.memory.setLongTerm('morning-brief-feedback', existingFeedback);
    }
    
    // Update preferences based on feedback
    if (feedback.preferredSections) {
      this.memory.setLongTerm('preferred-brief-sections', feedback.preferredSections);
    }
    
    if (feedback.tooLong !== undefined) {
      this.memory.setLongTerm('prefer-concise-briefs', feedback.tooLong);
    }
  }
  
  /**
   * Override buildMessages to include user preferences from memory
   */
  protected buildMessages(prompt: string): any[] {
    const messages = super.buildMessages(prompt);
    
    // Add user preferences if available
    const preferredSections = this.memory.getLongTerm<string[]>('preferred-brief-sections');
    if (preferredSections) {
      messages.push({
        role: 'system',
        content: `User prefers these sections in morning brief: ${preferredSections.join(', ')}`,
      });
    }
    
    const preferConcise = this.memory.getLongTerm<boolean>('prefer-concise-briefs');
    if (preferConcise) {
      messages.push({
        role: 'system',
        content: 'User prefers VERY concise briefs. Keep it short and to the point.',
      });
    }
    
    // Add recent feedback if available
    const recentFeedback = this.memory.getLongTerm<any[]>('morning-brief-feedback');
    if (recentFeedback && recentFeedback.length > 0) {
      const lastFeedback = recentFeedback[recentFeedback.length - 1];
      if (lastFeedback.missingInfo) {
        messages.push({
          role: 'system',
          content: `Recent feedback: User mentioned missing info: ${lastFeedback.missingInfo}`,
        });
      }
    }
    
    return messages;
  }
}