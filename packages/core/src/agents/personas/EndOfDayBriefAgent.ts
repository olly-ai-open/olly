import { BaseAgent, AgentConfig } from '../base/Agent';
import { EmailTool } from '../tools/EmailTool';
import { DriveTool } from '../tools/DriveTool';
import { SlackTool } from '../tools/SlackTool';
import { END_OF_DAY_BRIEF_PROMPT } from '../../prompts/endOfDayBriefPrompt';
import type { EndOfDayActionItem, EndOfDayDocInput } from '../../types/endOfDay';

type EndOfDaySummaryJSON = {
  highlights?: string[];
  risks?: string[];
  action_items?: Array<{
    title?: string;
    due_date?: string | null;
    link?: string | null;
    source?: string | null;
    assignee?: string | null;
  }>;
  docs?: Array<{
    title?: string;
    link?: string | null;
    source?: string | null;
  }>;
};

function safeParseEndOfDaySummaryJSON(s: string): EndOfDaySummaryJSON | null {
  try {
    return JSON.parse(s) as EndOfDaySummaryJSON;
  } catch {}
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const sub = s.slice(first, last + 1);
    try {
      return JSON.parse(sub) as EndOfDaySummaryJSON;
    } catch {}
  }
  return null;
}

function normalizeDocsFromToolCalls(
  toolCalls: Array<{ toolName: string; result: any }> | undefined,
  maxDocs = 20,
): { title: string; link?: string | null; source?: string | null }[] {
  if (!toolCalls?.length) return [];
  const docs: { title: string; link?: string | null; source?: string | null }[] = [];
  const seen = new Set<string>();

  const addDoc = (doc: { title: string; link?: string | null; source?: string | null }) => {
    const key = `${doc.source || ''}|${doc.title || ''}|${doc.link || ''}`.toLowerCase();
    if (!doc.title || seen.has(key)) return;
    seen.add(key);
    docs.push(doc);
  };

  for (const call of toolCalls) {
    if (!call?.result) continue;
    if (call.toolName === 'slack' && Array.isArray(call.result.messages)) {
      for (const msg of call.result.messages) {
        const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
        addDoc({
          title: text ? text.slice(0, 120) : 'Slack message',
          link: typeof msg?.permalink === 'string' ? msg.permalink : null,
          source: 'slack',
        });
        if (docs.length >= maxDocs) return docs;
      }
    }
    if (call.toolName === 'email' && Array.isArray(call.result.messages)) {
      for (const msg of call.result.messages) {
        const subject =
          typeof msg?.subject === 'string' && msg.subject.trim().length
            ? msg.subject.trim()
            : typeof msg?.snippet === 'string'
              ? msg.snippet.trim()
              : 'Email message';
        addDoc({
          title: subject,
          link: typeof msg?.url === 'string' ? msg.url : null,
          source: 'gmail',
        });
        if (docs.length >= maxDocs) return docs;
      }
    }
    if (call.toolName === 'drive' && Array.isArray(call.result.files)) {
      for (const file of call.result.files) {
        addDoc({
          title: typeof file?.name === 'string' ? file.name : 'Drive file',
          link: typeof file?.webViewLink === 'string' ? file.webViewLink : null,
          source: 'google_drive',
        });
        if (docs.length >= maxDocs) return docs;
      }
    }
    if (call.toolName === 'drive' && call.result.file) {
      const file = call.result.file;
      addDoc({
        title: typeof file?.name === 'string' ? file.name : 'Drive file',
        link: typeof file?.webViewLink === 'string' ? file.webViewLink : null,
        source: 'google_drive',
      });
      if (docs.length >= maxDocs) return docs;
    }
  }

  return docs;
}

function parseEndOfDaySummary(
  raw: string,
  assigneeLabel: string,
  docsFallback: { title: string; link?: string | null; source?: string | null }[],
) {
  const parsed = safeParseEndOfDaySummaryJSON(raw);

  const highlights = Array.isArray(parsed?.highlights)
    ? parsed!.highlights.filter((v) => typeof v === 'string' && v.trim())
    : [];
  const risks = Array.isArray(parsed?.risks)
    ? parsed!.risks.filter((v) => typeof v === 'string' && v.trim())
    : [];

  const actionItems =
    Array.isArray(parsed?.action_items) && parsed.action_items.length
      ? parsed.action_items
          .map((ai) => ({
            title: (ai?.title ?? '').trim(),
            dueDate:
              ai?.due_date && typeof ai.due_date === 'string'
                ? ai.due_date
                : null,
            link:
              ai?.link && typeof ai.link === 'string' && ai.link.trim()
                ? ai.link
                : null,
            source:
              ai?.source && typeof ai.source === 'string' && ai.source.trim()
                ? ai.source
                : null,
            assignee:
              ai?.assignee && typeof ai.assignee === 'string' && ai.assignee.trim()
                ? ai.assignee
                : assigneeLabel,
          }))
          .filter((ai) => ai.title.length > 0)
      : [];

  const docs =
    Array.isArray(parsed?.docs) && parsed.docs.length
      ? parsed.docs
          .map((d) => ({
            title: (d?.title ?? '').trim(),
            link:
              d?.link && typeof d.link === 'string' && d.link.trim()
                ? d.link
                : null,
            source:
              d?.source && typeof d.source === 'string' && d.source.trim()
                ? d.source
                : null,
          }))
          .filter((d) => d.title.length > 0)
      : docsFallback;

  return { highlights, risks, actionItems, docs };
}

export class EndOfDayBriefAgent extends BaseAgent {
  constructor(config?: Partial<AgentConfig>) {
    super({
      name: 'EndOfDayBriefAgent',
      description: 'Generates end-of-day summaries from recent workspace updates',
      model: config?.model || process.env.OPENAI_MODEL || 'gpt-4.1',
      ...config,
      tools: [
        new EmailTool(),
        new DriveTool(),
        new SlackTool(),
        ...(config?.tools || []),
      ],
      systemPrompt: `${config?.systemPrompt || END_OF_DAY_BRIEF_PROMPT}\n\nStrict output format:
        - Return ONLY a single MINIFIED JSON object with these keys:
        {
          \"highlights\": string[],
          \"risks\": string[],
          \"action_items\": [
            {
              \"title\": string,
              \"due_date\": string | null,
              \"link\": string | null,
              \"source\": string | null,
              \"assignee\": string
            }
          ],
          \"docs\": [
            {
              \"title\": string,
              \"link\": string | null,
              \"source\": string | null
            }
          ]
        }
        - No code fences. No commentary outside the JSON.`
    });
  }

  protected getDefaultSystemPrompt(): string {
    return END_OF_DAY_BRIEF_PROMPT;
  }

  async generateEndOfDaySummary(
    userId: string,
    opts: {
      briefTime: string;
      windowHours: number;
      documents: EndOfDayDocInput[];
      assigneeLabel?: string;
    }
  ): Promise<{
    highlights: string[];
    risks: string[];
    actionItems: EndOfDayActionItem[];
    docs: { title: string; link?: string | null; source?: string | null }[];
    llmContext: {
      systemPrompt: string;
      userPrompt: string;
      response: string;
      model: string;
      temperature: number;
    };
  }> {
    if (!process.env.OPENAI_API_KEY) {
      const placeholder = `End of day summary placeholder (no OpenAI key). Time: ${opts.briefTime}, window: last ${opts.windowHours}h. Docs: ${opts.documents.length}.`;
      return {
        highlights: [],
        risks: [],
        actionItems: [],
        docs: opts.documents
          .slice(0, 10)
          .map((d) => ({ title: d.title, link: d.link ?? null, source: d.source })),
        llmContext: {
          systemPrompt: 'No OpenAI key configured',
          userPrompt: `Placeholder end of day summary for ${opts.briefTime}`,
          response: placeholder,
          model: 'none',
          temperature: 0,
        },
      };
    }

    const assigneeLabel = opts.assigneeLabel || 'user';

    const docList =
      opts.documents.length === 0
        ? 'None'
        : opts.documents
            .map((d, idx) => {
              const metaParts = [
                `source: ${d.source}`,
                `updatedAt: ${d.updatedAt}`,
                d.docType ? `type: ${d.docType}` : '',
                d.meetingId ? `meetingId: ${d.meetingId}` : '',
                d.isCleanedSummary ? 'cleaned summary: yes' : '',
                d.summaryOfId ? `summaryOfId: ${d.summaryOfId}` : '',
                Array.isArray(d.tags) && d.tags.length
                  ? `tags: ${d.tags.join(', ')}`
                  : '',
                d.link ? `link: ${d.link}` : '',
              ]
                .map((p) => p.trim())
                .filter(Boolean)
                .join('; ');
              return [
                `${idx + 1}. ${d.title} (${metaParts})`,
                `Content:\n${d.text}`,
              ].join('\n');
            })
            .join('\n\n');

    const userPrompt = [
      `Brief time: ${opts.briefTime}`,
      `Window: last ${opts.windowHours} hours ending at brief time`,
      `Assign all action items to: ${assigneeLabel}`,
      '',
      'Documents:',
      docList,
      '',
      'Return only the JSON object described in the system prompt.',
    ].join('\n');

    const result = await this.execute(userPrompt, {
      userId,
      sessionId: `end-of-day-${opts.briefTime}`,
    });

    const raw = result.text ?? '';
    const fallbackDocs = opts.documents.slice(0, 10).map((d) => ({
      title: d.title,
      link: d.link ?? null,
      source: d.source,
    }));
    const { highlights, risks, actionItems, docs } = parseEndOfDaySummary(
      raw,
      assigneeLabel,
      fallbackDocs,
    );

    return {
      highlights,
      risks,
      actionItems,
      docs,
      llmContext: {
        systemPrompt: this.systemPrompt,
        userPrompt,
        response: raw,
        model: this.model,
        temperature: this.temperature,
      },
    };
  }

  async generateEndOfDaySummaryFromWorkspace(
    userId: string,
    opts: {
      briefTime: string;
      windowHours: number;
      timeZone?: string;
      assigneeLabel?: string;
    }
  ): Promise<{
    highlights: string[];
    risks: string[];
    actionItems: EndOfDayActionItem[];
    docs: { title: string; link?: string | null; source?: string | null }[];
    llmContext: {
      systemPrompt: string;
      userPrompt: string;
      response: string;
      model: string;
      temperature: number;
    };
  }> {
    if (!process.env.OPENAI_API_KEY) {
      const placeholder = `End of day summary placeholder (no OpenAI key). Time: ${opts.briefTime}, window: last ${opts.windowHours}h.`;
      return {
        highlights: [],
        risks: [],
        actionItems: [],
        docs: [],
        llmContext: {
          systemPrompt: 'No OpenAI key configured',
          userPrompt: `Placeholder end of day summary for ${opts.briefTime}`,
          response: placeholder,
          model: 'none',
          temperature: 0,
        },
      };
    }

    const assigneeLabel = opts.assigneeLabel || 'user';
    const timeZone = opts.timeZone || 'UTC';
    const windowHours = Math.max(1, Math.floor(opts.windowHours));
    const searchDays = Math.max(1, Math.ceil(windowHours / 24));
    const briefDate = new Date(opts.briefTime);
    const windowEnd = Number.isNaN(briefDate.getTime())
      ? new Date()
      : briefDate;
    const windowStart = new Date(windowEnd.getTime() - windowHours * 60 * 60 * 1000);

    const prompt = [
      `Generate an end-of-day summary for the user.`,
      `Brief time: ${opts.briefTime} (${timeZone}).`,
      `Window: last ${windowHours} hours ending at brief time.`,
      `Window start: ${windowStart.toISOString()}.`,
      `Window end: ${windowEnd.toISOString()}.`,
      '',
      'Use tools to gather relevant updates within the window:',
      `- Slack: search for status updates, decisions, blockers, and action items. Use timeframe ${windowStart.toISOString()} to ${windowEnd.toISOString()}.`,
      `- Gmail: search for updates/decisions/blockers (use newer_than:${searchDays}d in the query).`,
      `- Drive: search for docs updated in the window (modifiedAfter/modifiedBefore). Open top results to extract content.`,
      '',
      'Guidelines:',
      '- Prefer cleaned summaries if you find them.',
      '- Ignore boilerplate or system-generated noise.',
      '- Track EACH individual source used and include it in docs (title, link, source).',
      '- Keep the brief concise and factual.',
      '',
      `Assign all action items to: ${assigneeLabel}.`,
      'Return only the JSON object described in the system prompt.',
    ].join('\n');

    const result = await this.execute(prompt, {
      userId,
      sessionId: `end-of-day-${opts.briefTime}`,
    });

    const raw = result.text ?? '';
    const fallbackDocs = normalizeDocsFromToolCalls(result.toolCalls);
    const { highlights, risks, actionItems, docs } = parseEndOfDaySummary(
      raw,
      assigneeLabel,
      fallbackDocs,
    );

    return {
      highlights,
      risks,
      actionItems,
      docs,
      llmContext: {
        systemPrompt: this.systemPrompt,
        userPrompt: prompt,
        response: raw,
        model: this.model,
        temperature: this.temperature,
      },
    };
  }
}
