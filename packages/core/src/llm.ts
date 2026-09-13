import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { MEETING_BRIEF_PROMPT } from "./prompts/meetingBriefPrompt";
import type { BriefJSON, MorningBriefJSON } from "./types/briefs";
import type { EndOfDayActionItem } from "./types/endOfDay";
import { QUERY_PLANNER_PROMPT } from "./prompts/queryPlannerPrompt";

// LLM Provider types
export type LLMProvider = "openai" | "anthropic" | "gemini";

// Default models per provider
const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-haiku-4-5-20251202",
  gemini: "gemini-1.5-pro",
};

/**
 * Get the current LLM provider from environment
 */
export function getLLMProvider(): LLMProvider {
  const provider = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (provider === "anthropic" || provider === "gemini") {
    return provider;
  }
  return "openai"; // default
}

/**
 * Get the model for the current provider
 */
export function getLLMModel(): string {
  const provider = getLLMProvider();
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_MODEL || DEFAULT_MODELS.anthropic;
    case "gemini":
      return process.env.GOOGLE_MODEL || DEFAULT_MODELS.gemini;
    default:
      return process.env.OPENAI_MODEL || DEFAULT_MODELS.openai;
  }
}

/**
 * Get the temperature for LLM calls
 */
export function getLLMTemperature(): number {
  return parseFloat(process.env.LLM_TEMPERATURE ?? process.env.OPENAI_TEMPERATURE ?? "0.2");
}

/**
 * Check if LLM is configured (has API key for the current provider)
 */
export function isLLMConfigured(): boolean {
  const provider = getLLMProvider();
  switch (provider) {
    case "anthropic":
      return !!process.env.ANTHROPIC_API_KEY;
    case "gemini":
      return !!process.env.GEMINI_API_KEY;
    default:
      return !!process.env.OPENAI_API_KEY;
  }
}

// Legacy function for backward compatibility
export function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

/**
 * Unified chat completion that works with all providers
 */
export async function createChatCompletion(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  opts?: { temperature?: number; model?: string }
): Promise<{ content: string; model: string; provider: LLMProvider }> {
  const provider = getLLMProvider();
  const model = opts?.model || getLLMModel();
  const temperature = opts?.temperature ?? getLLMTemperature();

  switch (provider) {
    case "anthropic": {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

      const client = new Anthropic({ apiKey });
      const systemMessage = messages.find(m => m.role === "system")?.content || "";
      const nonSystemMessages = messages
        .filter(m => m.role !== "system")
        .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        system: systemMessage,
        messages: nonSystemMessages,
        temperature,
      });

      const textBlock = response.content.find(block => block.type === "text");
      return {
        content: textBlock?.type === "text" ? textBlock.text : "",
        model,
        provider: "anthropic",
      };
    }

    case "gemini": {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

      const genAI = new GoogleGenerativeAI(apiKey);
      const geminiModel = genAI.getGenerativeModel({ model });

      // Combine system and user messages for Gemini
      const systemMessage = messages.find(m => m.role === "system")?.content || "";
      const userMessages = messages.filter(m => m.role !== "system");
      const prompt = systemMessage
        ? `${systemMessage}\n\n${userMessages.map(m => m.content).join("\n")}`
        : userMessages.map(m => m.content).join("\n");

      const result = await geminiModel.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature },
      });

      return {
        content: result.response.text(),
        model,
        provider: "gemini",
      };
    }

    default: {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

      const client = new OpenAI({ apiKey });
      const response = await client.chat.completions.create({
        model,
        messages,
        temperature,
      });

      return {
        content: response.choices[0]?.message?.content ?? "",
        model,
        provider: "openai",
      };
    }
  }
}

export function safeParseBriefJSON(s: string): BriefJSON | null {
  try {
    return JSON.parse(s) as BriefJSON;
  } catch {}
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const sub = s.slice(first, last + 1);
    try {
      return JSON.parse(sub) as BriefJSON;
    } catch {}
  }
  return null;
}

type SearchQueriesJSON = {
  drive_queries?: string[];
  gmail_queries?: string[];
  slack_queries?: string[];
};

function safeParseSearchQueriesJSON(s: string): SearchQueriesJSON | null {
  try {
    return JSON.parse(s) as SearchQueriesJSON;
  } catch {}
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const sub = s.slice(first, last + 1);
    try {
      return JSON.parse(sub) as SearchQueriesJSON;
    } catch {}
  }
  return null;
}

export function safeParseMorningBriefJSON(s: string): MorningBriefJSON | null {
  try {
    return JSON.parse(s) as MorningBriefJSON;
  } catch {}
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const sub = s.slice(first, last + 1);
    try {
      return JSON.parse(sub) as MorningBriefJSON;
    } catch {}
  }
  return null;
}

export type { BriefJSON, MorningBriefJSON } from "./types/briefs";
export type { EndOfDayActionItem } from "./types/endOfDay";

export async function generateBriefFromContext(
  input: {
    meeting: {
      title: string;
      start?: string | null;
      attendees: { email?: string | null }[];
      description?: string | null;
    };
    drive: {
      name?: string | null;
      webViewLink?: string | null;
      mimeType?: string | null;
      content?: string | null;
    }[];
    gmail: {
      id?: string | null;
      snippet?: string | null;
      body?: string | null;
      subject?: string | null;
      from?: string | null;
      to?: string | null;
      attachments?: {
        id?: string | null;
        filename?: string | null;
        mimeType?: string | null;
        size?: number | null;
        textContent?: string | null;
      }[];
    }[];
    slack: {
      id?: string | null;
      text?: string | null;
      ts?: string | null;
      userId?: string | null;
      username?: string | null;
      channel?: { id?: string | null; name?: string | null } | null;
      permalink?: string | null;
    }[];
  },
  opts?: { systemPromptOverride?: string },
) {
  const llmConfigured = isLLMConfigured();
  const sources: string[] = [];
  for (const f of input.drive.slice(0, 5))
    if (f?.webViewLink) sources.push(`Drive: ${f.name} -> ${f.webViewLink}`);
  for (const m of input.gmail.slice(0, 5))
    if (m?.id) {
      const baseUrl = `https://mail.google.com/mail/u/0/#inbox/${m.id}`;
      const subjectLabel =
        m.subject && m.subject.trim().length
          ? m.subject.trim()
          : "Email thread";
      sources.push(`Gmail: ${subjectLabel} -> ${baseUrl}`);

      const attachments = Array.isArray(m.attachments) ? m.attachments : [];
      attachments.slice(0, 3).forEach((att) => {
        const name = (att.filename || "(attachment)").trim();
        sources.push(
          `Attachment: ${name} (from "${subjectLabel}") -> ${baseUrl}`,
        );
      });
    }
  const slackMessages = Array.isArray(input.slack) ? input.slack : [];
  for (const m of slackMessages.slice(0, 5)) {
    if (m?.permalink) {
      const channelLabel = m.channel?.name
        ? `#${m.channel.name}`
        : "Slack message";
      sources.push(`${channelLabel} -> ${m.permalink}`);
    }
  }

  const confidence =
    sources.length >= 3 ? "high" : sources.length > 0 ? "medium" : "low";

  if (!llmConfigured) {
    const provider = getLLMProvider();
    const placeholderContent = `# Meeting Brief\n\n_No ${provider} API key configured. Placeholder brief for:_ ${input.meeting.title}`;
    return {
      content: {
        brief_markdown: placeholderContent,
        goals: [],
        action_items: [],
        key_context: [],
      } satisfies BriefJSON,
      confidence,
      sources,
      llmContext: {
        systemPrompt: `No ${provider} API key configured`,
        userPrompt: `Placeholder request for: ${input.meeting.title}`,
        response: placeholderContent,
        model: "none",
        temperature: 0,
      },
    };
  }

  const systemBase =
    opts?.systemPromptOverride && opts.systemPromptOverride.trim().length
      ? opts.systemPromptOverride
      : MEETING_BRIEF_PROMPT;
  const system = `${systemBase}\n\nStrict output format:
    - Return ONLY a single MINIFIED JSON object with these keys:
    {
      \"brief_markdown\": string, // full report as markdown in the format above (<= 1 page)
      \"goals\": [                // optional, high-level meeting goals
        string                   // short, non-assignable goal statements
      ],
      \"key_context\": string []   // a list of up to 3 key context points
    }
    - No code fences. No commentary outside the JSON.`;
  const user = `Meeting: ${input.meeting.title}\nDate/Time: ${input.meeting.start ?? "unknown"}\nParticipants: ${
    (input.meeting.attendees || [])
      .map((a) => a.email)
      .filter(Boolean)
      .join(", ") || "unknown"
  }\nDescription: ${input.meeting.description ?? ""}\n\nContext:\nDrive files:\n${input.drive
    .map((f) => {
      let fileInfo = `- ${f.name ?? "(untitled)"} (${f.mimeType ?? "?"})`;
      if (f.content) {
        fileInfo += `\n  Content excerpt: ${f.content}`;
      }
      if (f.webViewLink) {
        fileInfo += `\n  Link: ${f.webViewLink}`;
      }
      return fileInfo;
    })
    .join("\n")}\n\nGmail emails:\n${input.gmail
    .map((g) => {
      const subject = g.subject ? `Subject: ${g.subject}` : "";
      const from = g.from ? `From: ${g.from}` : "";
      const body = g.body || g.snippet || "(no content)";
      const attachments = Array.isArray(g.attachments) ? g.attachments : [];
      const attachmentsBlock = attachments.length
        ? `\n  Attachments:\n${attachments
            .slice(0, 3)
            .map((a) => {
              const label = a.filename || "(attachment)";
              const sizeLabel =
                typeof a.size === "number" && a.size > 0
                  ? `, ~${Math.round(a.size / 1024)} KB`
                  : "";
              const metaLine = `  - ${label} (${a.mimeType || "unknown"}${sizeLabel})`;
              const excerpt =
                a.textContent && a.textContent.trim().length
                  ? `\n    Excerpt: ${a.textContent.trim()}`
                  : "";
              return `${metaLine}${excerpt}`;
            })
            .join("\n")}`
        : "";
      return `- ${subject}\n  ${from}\n  Content: ${body}${attachmentsBlock}`;
    })
    .join(
      "\n\n",
    )}\n\nSlack messages:\n${slackMessages
    .map((s) => {
      const channel = s.channel?.name ? `#${s.channel.name}` : "Slack";
      const author = s.username || s.userId || "";
      const link = s.permalink ? `\n  Link: ${s.permalink}` : "";
      const tsLine = s.ts ? `\n  Timestamp: ${s.ts}` : "";
      return `- ${channel}${author ? ` (from ${author})` : ""}${tsLine}\n  Content: ${s.text || "(no content)"}${link}`;
    })
    .join("\n\n")}\n\nReturn ONLY the JSON object with the keys described above.`;

  const completion = await createChatCompletion([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);

  const raw = completion.content;
  const parsed = safeParseBriefJSON(raw);
  const content: BriefJSON = parsed ?? {
    brief_markdown: raw,
    goals: [],
    key_context: [],
  };

  return {
    content,
    confidence,
    sources,
    llmContext: {
      systemPrompt: system,
      userPrompt: user,
      response: raw,
      model: completion.model,
      temperature: getLLMTemperature(),
    },
  };
}

export async function generateSearchQueriesForEvent(
  input: {
    meeting: {
      title: string;
      start?: string | null;
      attendees: { email?: string | null }[];
      description?: string | null;
    };
  },
  opts?: { systemPromptOverride?: string },
): Promise<{ driveQueries: string[]; gmailQueries: string[]; slackQueries: string[] }> {
  if (!isLLMConfigured()) {
    return { driveQueries: [], gmailQueries: [], slackQueries: [] };
  }

  const participantList =
    (input.meeting.attendees || [])
      .map((a) => a.email)
      .filter(Boolean)
      .join(", ") || "unknown";

  const system =
    opts?.systemPromptOverride && opts.systemPromptOverride.trim().length
      ? opts.systemPromptOverride
      : QUERY_PLANNER_PROMPT;

  const user = `Meeting:\n- Title: ${input.meeting.title}\n- Date/Time: ${input.meeting.start ?? "unknown"}\n- Participants: ${participantList}\n- Description: ${input.meeting.description ?? ""}\n\nReturn only the JSON object as described.`;

  const completion = await createChatCompletion([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);

  const raw = completion.content;
  const parsed = safeParseSearchQueriesJSON(raw);
  const driveQueries = Array.isArray(parsed?.drive_queries)
    ? parsed!.drive_queries.filter((q) => typeof q === "string" && q.trim())
    : [];
  const gmailQueries = Array.isArray(parsed?.gmail_queries)
    ? parsed!.gmail_queries.filter((q) => typeof q === "string" && q.trim())
    : [];
  const slackQueries = Array.isArray(parsed?.slack_queries)
    ? parsed!.slack_queries.filter((q) => typeof q === "string" && q.trim())
    : [];

  return {
    driveQueries,
    gmailQueries,
    slackQueries,
  };
}
