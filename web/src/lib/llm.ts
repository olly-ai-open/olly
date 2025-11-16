import OpenAI from "openai";
import { MEETING_BRIEF_PROMPT } from "@/lib/prompts/meetingBriefPrompt";

export function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

type BriefJSON = {
  brief_markdown: string;
  action_items: Array<{
    description: string;
    assignee?: string | null;
    due_date?: string | null;
    priority?: "high" | "medium" | "low" | string | null;
  }>;
};

function safeParseBriefJSON(s: string): BriefJSON | null {
  try {
    return JSON.parse(s) as BriefJSON;
  } catch {}
  // Try to extract the first {...} block
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
    }[];
  },
  opts?: { systemPromptOverride?: string },
) {
  const openai = getOpenAI();
  const sources: string[] = [];
  for (const f of input.drive.slice(0, 5))
    if (f?.webViewLink) sources.push(`Drive: ${f.name} -> ${f.webViewLink}`);
  for (const m of input.gmail.slice(0, 5))
    if (m?.id)
      sources.push(`Gmail: https://mail.google.com/mail/u/0/#inbox/${m.id}`);

  const confidence =
    sources.length >= 3 ? "high" : sources.length > 0 ? "medium" : "low";

  if (!openai) {
    const placeholderContent = `# Meeting Brief\n\n_No OpenAI key configured. Placeholder brief for:_ ${input.meeting.title}`;
    return {
      content: {
        brief_markdown: placeholderContent,
        action_items: [],
      } satisfies BriefJSON,
      confidence,
      sources,
      llmContext: {
        systemPrompt: "No OpenAI key configured",
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
  const system = `${systemBase}\n\nStrict output format:\n- Return ONLY a single MINIFIED JSON object with these keys:\n{\n  \"brief_markdown\": string, // full report as markdown in the format above (<= 1 page)\n  \"action_items\": [         // separate, structured list for backend creation\n    {\n      \"description\": string,\n      \"assignee\"?: string,   // email or full name if available\n      \"due_date\"?: string,   // ISO if known, else empty\n      \"priority\"?: \"high\"|\"medium\"|\"low\"\n    }\n  ]\n}\n- No code fences. No commentary outside the JSON.`;
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
      return `- ${subject}\n  ${from}\n  Content: ${body}`;
    })
    .join(
      "\n\n",
    )}\n\nReturn ONLY the JSON object with the keys described above.`;

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: parseFloat(process.env.OPENAI_TEMPERATURE ?? "0.2"),
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  const parsed = safeParseBriefJSON(raw);
  const content: BriefJSON = parsed ?? {
    brief_markdown: raw,
    action_items: [],
  };

  return {
    content,
    confidence,
    sources,
    // Return the actual prompts used for debugging
    llmContext: {
      systemPrompt: system,
      userPrompt: user,
      response: raw,
      model: process.env.OPENAI_MODEL || "gpt-4.1",
      temperature: parseFloat(process.env.OPENAI_TEMPERATURE ?? "0.2"),
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
): Promise<{ driveQueries: string[]; gmailQueries: string[] }> {
  const openai = getOpenAI();
  if (!openai) {
    return { driveQueries: [], gmailQueries: [] };
  }

  const participantList =
    (input.meeting.attendees || [])
      .map((a) => a.email)
      .filter(Boolean)
      .join(", ") || "unknown";

  const defaultSystem = [
    "You are an assistant that designs Google Workspace search queries for a single calendar meeting.",
    "Your goal is to suggest a small set of highly relevant search queries for:",
    "- Gmail (using Gmail search syntax like from:, to:, subject:, quoted phrases, etc.)",
    "- Google Drive (short natural-language phrases to match file names or contents).",
    "",
    "Rules:",
    "- Consider the meeting title, time, attendees, and description.",
    "- For Drive, output short phrases (2–6 words) that should match project names, topics, or doc titles.",
    "- For Gmail, output valid Gmail search queries (you can combine from:/to:/subject: and quoted phrases).",
    "- DO NOT include time-window filters like newer_than:Xd; the backend will add those.",
    "- DO NOT include advanced Drive query syntax; just the phrase to search for.",
    "",
    "Output format:",
    "- Return ONLY a single MINIFIED JSON object with keys:",
    '{ "drive_queries": string[], "gmail_queries": string[] }',
    "- No comments, no code fences, no additional keys.",
  ].join("\n");

  const system =
    opts?.systemPromptOverride && opts.systemPromptOverride.trim().length
      ? opts.systemPromptOverride
      : defaultSystem;

  const user = `Meeting:\n- Title: ${input.meeting.title}\n- Date/Time: ${input.meeting.start ?? "unknown"}\n- Participants: ${participantList}\n- Description: ${input.meeting.description ?? ""}\n\nReturn only the JSON object as described.`;

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: parseFloat(process.env.OPENAI_TEMPERATURE ?? "0.2"),
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  const parsed = safeParseSearchQueriesJSON(raw);
  const driveQueries = Array.isArray(parsed?.drive_queries)
    ? parsed!.drive_queries.filter((q) => typeof q === "string" && q.trim())
    : [];
  const gmailQueries = Array.isArray(parsed?.gmail_queries)
    ? parsed!.gmail_queries.filter((q) => typeof q === "string" && q.trim())
    : [];

  return {
    driveQueries,
    gmailQueries,
  };
}
