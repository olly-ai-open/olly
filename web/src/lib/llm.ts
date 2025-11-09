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

export async function generateBriefFromContext(input: {
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
  }[];
  gmail: { id?: string | null; snippet?: string | null }[];
}) {
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
    return {
      content: {
        brief_markdown: `# Meeting Brief\n\n_No OpenAI key configured. Placeholder brief for:_ ${input.meeting.title}`,
        action_items: [],
      } satisfies BriefJSON,
      confidence,
      sources,
    };
  }

  const system = `${MEETING_BRIEF_PROMPT}\n\nStrict output format:\n- Return ONLY a single MINIFIED JSON object with these keys:\n{\n  \"brief_markdown\": string, // full report as markdown in the format above (<= 1 page)\n  \"action_items\": [         // separate, structured list for backend creation\n    {\n      \"description\": string,\n      \"assignee\"?: string,   // email or full name if available\n      \"due_date\"?: string,   // ISO if known, else empty\n      \"priority\"?: \"high\"|\"medium\"|\"low\"\n    }\n  ]\n}\n- No code fences. No commentary outside the JSON.`;
  const user = `Meeting: ${input.meeting.title}\nDate/Time: ${input.meeting.start ?? "unknown"}\nParticipants: ${
    (input.meeting.attendees || [])
      .map((a) => a.email)
      .filter(Boolean)
      .join(", ") || "unknown"
  }\nDescription: ${input.meeting.description ?? ""}\n\nContext:\nDrive files:\n${input.drive
    .map(
      (f) =>
        `- ${f.name ?? "(untitled)"} (${f.mimeType ?? "?"}) ${
          f.webViewLink ?? ""
        }`,
    )
    .join("\n")}\n\nGmail snippets:\n${input.gmail
    .map((g) => `- ${g.snippet ?? "(no snippet)"}`)
    .join("\n")}\n\nReturn ONLY the JSON object with the keys described above.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
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
  };
}
