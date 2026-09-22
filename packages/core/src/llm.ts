import OpenAI from "openai";
import { generateText, Output, type FlexibleSchema, type LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { MEETING_BRIEF_PROMPT } from "./prompts/meetingBriefPrompt";
import type { BriefJSON, MorningBriefJSON } from "./types/briefs";
import type { EndOfDayActionItem } from "./types/endOfDay";
import { QUERY_PLANNER_PROMPT } from "./prompts/queryPlannerPrompt";

import { getLLMSelection } from "./llm-context";

// LLM Provider types
export type LLMProvider = "openai" | "anthropic" | "gemini";
export const LLM_PROVIDERS: LLMProvider[] = ["openai", "anthropic", "gemini"];

export const LLM_PROVIDER_LABELS: Record<LLMProvider, string> = {
  openai: "OpenAI",
  anthropic: "Claude (Anthropic)",
  gemini: "Gemini (Google)",
};

/**
 * Default model per provider, used when neither the user's settings nor the
 * environment name one. The single source of truth: the agent framework
 * imports these too. Prefer undated IDs and "latest" aliases so the
 * defaults do not go stale.
 */
export const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-sonnet-5",
  gemini: "gemini-flash-latest",
};

export function isLLMProvider(value: unknown): value is LLMProvider {
  return typeof value === "string" && (LLM_PROVIDERS as string[]).includes(value);
}

/** Provider configured by the environment, before any per-user override. */
export function getDefaultLLMProvider(): LLMProvider {
  const provider = process.env.LLM_PROVIDER?.trim().toLowerCase();
  return isLLMProvider(provider) ? provider : "openai";
}

/** Model the environment names for a provider, else the built-in default. */
export function getDefaultLLMModel(provider: LLMProvider): string {
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_MODEL || DEFAULT_MODELS.anthropic;
    case "gemini":
      return process.env.GOOGLE_MODEL || DEFAULT_MODELS.gemini;
    default:
      return process.env.OPENAI_MODEL || DEFAULT_MODELS.openai;
  }
}

/** Which providers have an API key available in this deployment. */
export function getLLMProviderAvailability(): Record<LLMProvider, boolean> {
  return {
    openai: Boolean(process.env.OPENAI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
  };
}

/**
 * Get the current LLM provider: the user's selection when the request runs
 * under one (see llm-context.ts) and that provider has a key, else the
 * environment's provider.
 */
export function getLLMProvider(): LLMProvider {
  const selected = getLLMSelection()?.provider;
  if (selected && isLLMProvider(selected) && getLLMProviderAvailability()[selected]) {
    return selected;
  }
  return getDefaultLLMProvider();
}

/**
 * Get the model for the current provider: the user's model when they chose
 * one for the provider in use, else the environment's, else the default.
 */
export function getLLMModel(): string {
  const provider = getLLMProvider();
  const selection = getLLMSelection();
  const selectedProvider = selection?.provider ?? getDefaultLLMProvider();
  const model = selection?.model?.trim();
  if (model && selectedProvider === provider) return model;
  return getDefaultLLMModel(provider);
}

export type LLMEffort = "low" | "medium" | "high";
export const LLM_EFFORTS: LLMEffort[] = ["low", "medium", "high"];

export function isLLMEffort(value: unknown): value is LLMEffort {
  return typeof value === "string" && (LLM_EFFORTS as string[]).includes(value);
}

/** The user's reasoning-effort choice for this request, if any. */
export function getLLMEffort(): LLMEffort | null {
  const effort = getLLMSelection()?.effort;
  return isLLMEffort(effort) ? effort : null;
}

/**
 * Which models take a reasoning-effort hint. Unknown or older models get
 * none, since an unsupported parameter fails the request.
 */
export function supportsEffort(provider: LLMProvider, model: string): boolean {
  const m = model.toLowerCase();
  if (provider === "anthropic") {
    return /^claude-(opus-4-[5-8]|sonnet-4-6|opus-5|sonnet-5|fable|mythos)/.test(m);
  }
  if (provider === "openai") return /^(gpt-5|o\d)/.test(m);
  if (provider === "gemini") return /^gemini-3/.test(m);
  return false;
}

/**
 * Provider-specific options for the AI SDK: today only the effort hint.
 * Returns undefined when there is nothing to send.
 */
/**
 * A zod (3 or 4) or JSON schema describing structured output. Typed as an
 * opaque object on purpose: checking real schema types against the AI
 * SDK's schema union costs the type checker about 2 GB on this codebase.
 */
export type StructuredSchema = object;

export type LLMProviderOptions = Record<
  string,
  Record<string, string | Record<string, string>>
>;

export function buildProviderOptions(
  provider: LLMProvider,
  model: string,
  effort: LLMEffort | null,
): LLMProviderOptions | undefined {
  if (!effort || !supportsEffort(provider, model)) return undefined;
  switch (provider) {
    case "anthropic":
      return { anthropic: { effort } };
    case "openai":
      return { openai: { reasoningEffort: effort } };
    case "gemini":
      return { google: { thinkingConfig: { thinkingLevel: effort } } };
  }
}

/**
 * Build an AI SDK language model for the current provider and model. The
 * agent framework and the single-shot helpers below both use this, so
 * provider support lives in exactly one place.
 */
export function createLanguageModel(modelOverride?: string): {
  model: LanguageModel;
  provider: LLMProvider;
  modelName: string;
} {
  const provider = getLLMProvider();
  const modelName = modelOverride || getLLMModel();
  switch (provider) {
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      return { model: anthropic(modelName), provider, modelName };
    }
    case "gemini": {
      const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
      return { model: google(modelName), provider, modelName };
    }
    default: {
      const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
      return { model: openai(modelName), provider, modelName };
    }
  }
}

/**
 * Newer models reject the temperature parameter outright: OpenAI's reasoning
 * models (gpt-5 and o-series) and Anthropic's Claude 4.7 and later, Sonnet 5,
 * Opus 5, and Fable. Callers omit the parameter for those rather than fail
 * the request. Unknown Anthropic models are treated as not supporting it,
 * since a missing temperature only changes sampling while a rejected one
 * fails the call.
 */
export function supportsTemperature(provider: LLMProvider, model: string): boolean {
  const m = model.toLowerCase();
  if (provider === "openai") return !/^(gpt-5|o\d)/.test(m);
  if (provider === "anthropic") {
    return /^claude-(3|haiku-4-5|sonnet-4-5|opus-4-5|sonnet-4-6|opus-4-6)/.test(m);
  }
  return true;
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

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

function splitSystem(messages: ChatMessage[]) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const rest = messages
    .filter((m): m is ChatMessage & { role: "user" | "assistant" } => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  return { system: system || undefined, messages: rest };
}

function ensureKey(provider: LLMProvider) {
  const availability = getLLMProviderAvailability();
  if (!availability[provider]) {
    const name = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", gemini: "GEMINI_API_KEY" }[provider];
    throw new Error(`${name} not configured`);
  }
}

/**
 * Single-shot text completion for the current provider and model.
 */
export async function createChatCompletion(
  messages: ChatMessage[],
  opts?: { temperature?: number; model?: string }
): Promise<{ content: string; model: string; provider: LLMProvider }> {
  const { model, provider, modelName } = createLanguageModel(opts?.model);
  ensureKey(provider);
  const temperature = opts?.temperature ?? getLLMTemperature();
  const { system, messages: rest } = splitSystem(messages);
  const result = await generateText({
    model,
    system,
    messages: rest,
    ...(supportsTemperature(provider, modelName) && { temperature }),
    providerOptions: buildProviderOptions(provider, modelName, getLLMEffort()),
  });
  return { content: result.text, model: modelName, provider };
}

/**
 * Single-shot completion whose result is guaranteed to match `schema`.
 *
 * Uses each provider's native structured-output mode (JSON schema response
 * formats, or a forced JSON tool where the model has no native mode), so
 * callers get a parsed object and never scrape JSON out of prose. Keep
 * schemas strict-compatible: every key required, `.nullable()` rather than
 * `.optional()`, no free-form records.
 */
export async function createStructuredCompletion<T>(
  messages: ChatMessage[],
  // Accepts zod 3, zod 4, and plain JSON schemas. The result type is NOT
  // inferred from the schema: pass it explicitly, e.g.
  // createStructuredCompletion<z.infer<typeof MySchema>>(msgs, MySchema).
  // Inferring it costs the type checker gigabytes on large schemas.
  schema: StructuredSchema,
  opts?: { temperature?: number; model?: string; name?: string }
): Promise<{ object: T; model: string; provider: LLMProvider }> {
  const { model, provider, modelName } = createLanguageModel(opts?.model);
  ensureKey(provider);
  const temperature = opts?.temperature ?? getLLMTemperature();
  const { system, messages: rest } = splitSystem(messages);
  const result = await generateText({
    model,
    system,
    messages: rest,
    // `as any`: letting TypeScript infer the AI SDK's output generics from a
    // zod schema costs gigabytes of type-checker memory; the result is cast
    // to T below anyway.
    output: Output.object({ schema: schema as FlexibleSchema<any>, name: opts?.name }),
    ...(supportsTemperature(provider, modelName) && { temperature }),
    providerOptions: buildProviderOptions(provider, modelName, getLLMEffort()),
  });
  return { object: result.output as T, model: modelName, provider };
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
