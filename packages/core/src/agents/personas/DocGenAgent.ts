import { z } from 'zod';
import { BaseAgent, AgentConfig } from '../base/Agent';
import { EmailTool } from '../tools/EmailTool';
import { DriveTool } from '../tools/DriveTool';
import { SlackTool } from '../tools/SlackTool';
import {
  DOCGEN_INTENT_PARSER_PROMPT,
  DOCGEN_GATHER_PROMPT,
  DOCGEN_SYNTHESIZE_PROMPT,
  STATUS_UPDATE_PROMPT,
  MONTHLY_REPORT_PROMPT,
  WIKI_PROMPT,
} from '../../prompts/docgen';

/**
 * Document type enum
 */
export type DocType = 'status_update' | 'monthly_report' | 'wiki' | 'general';

/**
 * Parsed intent from user's free-text input
 */
export interface DocGenIntent {
  docType: DocType;
  timeScope: {
    start?: string;
    end?: string;
    days?: number;
  } | null;
  entity: string | null;
  context: string[] | null;
  sources: Array<'email' | 'drive' | 'slack'>;
}

/**
 * Evidence gathered from data sources
 */
export interface Evidence {
  evidenceId: string;
  sourceType: 'email' | 'drive' | 'slack';
  title: string;
  url?: string;
  date?: string;
  author?: string;
  snippet: string;
  relevanceScore?: number;
}

/**
 * A section in the generated document
 */
export interface DocSection {
  heading: string;
  content: string;
  citations: string[];
}

/**
 * Result of document generation
 */
export interface GeneratedDocResult {
  title: string;
  summary: string;
  sections: DocSection[];
  markdown: string;
  citations: Record<string, Evidence>;
  openQuestions: string[];
}

/**
 * Progress callback type
 */
export type ProgressCallback = (stage: string, message: string, percent: number) => void;

/** Structured-output schemas for the three document-generation calls. */
const DocGenIntentSchema = z.object({
  docType: z.enum(['status_update', 'monthly_report', 'wiki', 'general']),
  timeScope: z
    .object({
      start: z.string().nullable(),
      end: z.string().nullable(),
      days: z.number().nullable(),
    })
    .nullable(),
  entity: z.string().nullable(),
  context: z.array(z.string()).nullable(),
  sources: z.array(z.enum(['email', 'drive', 'slack'])),
});

const DocGenEvidenceSchema = z.object({
  evidence: z.array(
    z.object({
      evidenceId: z.string(),
      sourceType: z.enum(['email', 'drive', 'slack']),
      title: z.string(),
      url: z.string().nullable(),
      date: z.string().nullable(),
      author: z.string().nullable(),
      snippet: z.string(),
      relevanceScore: z.number().nullable(),
    }),
  ),
});

const DocGenDocumentSchema = z.object({
  title: z.string(),
  summary: z.string(),
  sections: z.array(
    z.object({
      heading: z.string(),
      content: z.string(),
      citations: z.array(z.string()),
    }),
  ),
  openQuestions: z.array(z.string()),
});

/**
 * DocGenAgent - Generates documents from workspace data sources
 *
 * This agent:
 * 1. Parses user intent from free-text input
 * 2. Gathers evidence from connected data sources
 * 3. Synthesizes a structured document with citations
 * 4. Handles multiple document types (status update, monthly report, wiki)
 */
export class DocGenAgent extends BaseAgent {
  constructor(config?: Partial<AgentConfig>) {
    super({
      name: 'DocGenAgent',
      description: 'Generates documents from workspace data sources with citations',
      ...config,
      tools: [
        new EmailTool(),
        new DriveTool(),
        new SlackTool(),
        ...(config?.tools || []),
      ],
    });
  }

  protected getDefaultSystemPrompt(): string {
    return DOCGEN_GATHER_PROMPT;
  }

  /**
   * Parse user intent from free-text input
   */
  async parseIntent(userPrompt: string): Promise<DocGenIntent> {
    const prompt = `${DOCGEN_INTENT_PARSER_PROMPT}

User request: "${userPrompt}"

Return ONLY the JSON object, no additional text.`;

    const result = await this.execute(
      prompt,
      { userId: 'system', sessionId: `intent-parse-${Date.now()}` },
      { outputSchema: DocGenIntentSchema },
    );

    if (result.output) {
      const o = result.output as z.infer<typeof DocGenIntentSchema>;
      return {
        docType: o.docType,
        timeScope: o.timeScope
          ? {
              ...(o.timeScope.start && { start: o.timeScope.start }),
              ...(o.timeScope.end && { end: o.timeScope.end }),
              ...(o.timeScope.days != null && { days: o.timeScope.days }),
            }
          : null,
        entity: o.entity,
        context: o.context,
        sources: o.sources,
      };
    }

    try {
      // Fallback: parse JSON from the text
      const text = result.text.trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as DocGenIntent;
      }
      return JSON.parse(text) as DocGenIntent;
    } catch (error) {
      // Return default intent if parsing fails
      console.error('Failed to parse intent:', error);
      return {
        docType: 'general',
        timeScope: { days: 30 },
        entity: null,
        context: null,
        sources: ['email', 'drive', 'slack'],
      };
    }
  }

  /**
   * Gather evidence from data sources based on intent
   */
  async gatherEvidence(
    userId: string,
    intent: DocGenIntent,
    onProgress?: ProgressCallback
  ): Promise<Evidence[]> {
    onProgress?.('gathering', 'Building search queries...', 10);

    // Build the gather prompt with intent context
    const timeConstraint = this.buildTimeConstraint(intent.timeScope);
    const entityContext = intent.entity ? `Focus on: "${intent.entity}"` : '';
    const additionalContext = intent.context?.length
      ? `Additional context: ${intent.context.join(', ')}`
      : '';

    const gatherPrompt = `${DOCGEN_GATHER_PROMPT}

SEARCH PARAMETERS:
- Document type: ${intent.docType}
- Time range: ${timeConstraint}
${entityContext}
${additionalContext}
- Sources to search: ${intent.sources.join(', ')}

Search all specified sources and gather relevant evidence. Return the JSON object as specified.`;

    onProgress?.('gathering', 'Searching connected sources...', 25);

    const result = await this.execute(
      gatherPrompt,
      { userId, sessionId: `gather-${Date.now()}` },
      { outputSchema: DocGenEvidenceSchema },
    );

    onProgress?.('gathering', 'Processing search results...', 40);

    if (result.output) {
      const o = result.output as z.infer<typeof DocGenEvidenceSchema>;
      return o.evidence.map((e) => ({
        evidenceId: e.evidenceId,
        sourceType: e.sourceType,
        title: e.title,
        ...(e.url && { url: e.url }),
        ...(e.date && { date: e.date }),
        ...(e.author && { author: e.author }),
        snippet: e.snippet,
        ...(e.relevanceScore != null && { relevanceScore: e.relevanceScore }),
      }));
    }

    try {
      const text = result.text.trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.evidence || [];
      }
      return [];
    } catch (error) {
      console.error('Failed to parse evidence:', error);
      // Try to extract evidence from tool calls
      return this.extractEvidenceFromToolCalls(result.toolCalls || []);
    }
  }

  /**
   * Synthesize a document from gathered evidence
   */
  async synthesizeDocument(
    userId: string,
    intent: DocGenIntent,
    evidence: Evidence[],
    template?: string,
    onProgress?: ProgressCallback
  ): Promise<GeneratedDocResult> {
    onProgress?.('synthesizing', 'Analyzing evidence...', 55);

    // Get document-type specific prompt
    const docTypePrompt = this.getDocTypePrompt(intent.docType);

    // Build synthesis prompt
    const synthesizePrompt = `${DOCGEN_SYNTHESIZE_PROMPT}

${docTypePrompt}

DOCUMENT PARAMETERS:
- Type: ${intent.docType}
- Subject: ${intent.entity || 'General workspace'}
- Context: ${intent.context?.join(', ') || 'None specified'}

${template ? `USER TEMPLATE (follow this structure exactly):\n${template}\n` : ''}

EVIDENCE TO USE:
${JSON.stringify(evidence, null, 2)}

Generate the document based on this evidence. Cite every factual claim with evidence IDs.
Return the JSON object as specified.`;

    onProgress?.('synthesizing', 'Generating document structure...', 70);

    const result = await this.execute(
      synthesizePrompt,
      { userId, sessionId: `synthesize-${Date.now()}` },
      { outputSchema: DocGenDocumentSchema },
    );

    onProgress?.('creating', 'Finalizing document...', 85);

    if (result.output) {
      return this.normalizeDocResult(result.output, evidence);
    }

    try {
      const text = result.text.trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return this.normalizeDocResult(parsed, evidence);
      }
      // If JSON parsing fails, create a basic result from the text
      return this.createFallbackResult(result.text, evidence, intent);
    } catch (error) {
      console.error('Failed to parse synthesized document:', error);
      return this.createFallbackResult(result.text, evidence, intent);
    }
  }

  /**
   * Main entry point: orchestrates the full document generation pipeline
   */
  async generateDocument(
    userId: string,
    userPrompt: string,
    options?: {
      template?: string;
      onProgress?: ProgressCallback;
    }
  ): Promise<GeneratedDocResult> {
    const { template, onProgress } = options || {};

    // Stage 1: Parse Intent
    onProgress?.('gathering', 'Understanding your request...', 5);
    const intent = await this.parseIntent(userPrompt);

    // Stage 2: Gather Evidence
    onProgress?.('gathering', 'Searching your workspace...', 15);
    const evidence = await this.gatherEvidence(userId, intent, onProgress);

    // Stage 3: Synthesize Document
    onProgress?.('synthesizing', 'Creating your document...', 55);
    const document = await this.synthesizeDocument(
      userId,
      intent,
      evidence,
      template,
      onProgress
    );

    onProgress?.('creating', 'Document ready!', 100);

    return document;
  }

  // ============ Private Helper Methods ============

  private buildTimeConstraint(timeScope: DocGenIntent['timeScope']): string {
    if (!timeScope) return 'All time (no specific range)';
    if (timeScope.days) return `Last ${timeScope.days} days`;
    if (timeScope.start && timeScope.end) {
      return `From ${timeScope.start} to ${timeScope.end}`;
    }
    if (timeScope.start) return `From ${timeScope.start} onwards`;
    if (timeScope.end) return `Until ${timeScope.end}`;
    return 'Last 30 days (default)';
  }

  private getDocTypePrompt(docType: DocType): string {
    switch (docType) {
      case 'status_update':
        return STATUS_UPDATE_PROMPT;
      case 'monthly_report':
        return MONTHLY_REPORT_PROMPT;
      case 'wiki':
        return WIKI_PROMPT;
      default:
        return STATUS_UPDATE_PROMPT;
    }
  }

  private extractEvidenceFromToolCalls(
    toolCalls: Array<{ toolName: string; result: any }>
  ): Evidence[] {
    const evidence: Evidence[] = [];
    let counter = 1;

    for (const call of toolCalls) {
      if (!call?.result) continue;

      if (call.toolName === 'email' && Array.isArray(call.result.messages)) {
        for (const msg of call.result.messages) {
          evidence.push({
            evidenceId: `ev_email_${counter++}`,
            sourceType: 'email',
            title: msg.subject || msg.snippet || 'Email',
            url: msg.url,
            date: msg.date,
            author: msg.from,
            snippet: msg.body?.slice(0, 500) || msg.snippet || '',
          });
        }
      }

      if (call.toolName === 'drive' && Array.isArray(call.result.files)) {
        for (const file of call.result.files) {
          evidence.push({
            evidenceId: `ev_drive_${counter++}`,
            sourceType: 'drive',
            title: file.name || 'Document',
            url: file.webViewLink,
            date: file.modifiedTime,
            snippet: file.content?.slice(0, 500) || '',
          });
        }
      }

      if (call.toolName === 'slack' && Array.isArray(call.result.messages)) {
        for (const msg of call.result.messages) {
          evidence.push({
            evidenceId: `ev_slack_${counter++}`,
            sourceType: 'slack',
            title: msg.text?.slice(0, 100) || 'Slack message',
            url: msg.permalink,
            date: msg.ts,
            author: msg.username || msg.userId,
            snippet: msg.text?.slice(0, 500) || '',
          });
        }
      }
    }

    return evidence;
  }

  private normalizeDocResult(
    parsed: any,
    evidence: Evidence[]
  ): GeneratedDocResult {
    // Build citations map from evidence
    const citations: Record<string, Evidence> = {};
    for (const ev of evidence) {
      citations[ev.evidenceId] = ev;
    }

    // Also include any citations from the parsed result
    if (parsed.allCitations) {
      Object.assign(citations, parsed.allCitations);
    }

    // Build markdown from sections
    const sections: DocSection[] = (parsed.sections || []).map((s: any) => ({
      heading: s.heading || 'Untitled Section',
      content: s.content || '',
      citations: s.citations || [],
    }));

    const markdown = this.buildMarkdown(parsed.title, sections);

    return {
      title: parsed.title || 'Generated Document',
      summary: parsed.summary || '',
      sections,
      markdown,
      citations,
      openQuestions: parsed.openQuestions || [],
    };
  }

  private createFallbackResult(
    text: string,
    evidence: Evidence[],
    intent: DocGenIntent
  ): GeneratedDocResult {
    const citations: Record<string, Evidence> = {};
    for (const ev of evidence) {
      citations[ev.evidenceId] = ev;
    }

    return {
      title: `${intent.docType.replace('_', ' ')} - ${intent.entity || 'Document'}`,
      summary: text.slice(0, 200),
      sections: [
        {
          heading: 'Content',
          content: text,
          citations: evidence.map((e) => e.evidenceId),
        },
      ],
      markdown: text,
      citations,
      openQuestions: [],
    };
  }

  private buildMarkdown(title: string, sections: DocSection[]): string {
    let md = `# ${title}\n\n`;

    for (const section of sections) {
      md += `## ${section.heading}\n\n`;
      md += `${section.content}\n\n`;
    }

    return md;
  }
}
