import OpenAI from "openai";

export function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

type BriefJSON = {
  title?: string;
  summary?: string;
  key_points?: string[];
  suggested_actions?: string[];
  risks?: string[];
  agenda?: string[];
  text?: string;
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
  drive: { name?: string | null; webViewLink?: string | null; mimeType?: string | null }[];
  gmail: { id?: string | null; snippet?: string | null }[];
}) {
  const openai = getOpenAI();
  const sources: string[] = [];
  for (const f of input.drive.slice(0, 5)) if (f?.webViewLink) sources.push(`Drive: ${f.name} -> ${f.webViewLink}`);
  for (const m of input.gmail.slice(0, 5)) if (m?.id) sources.push(`Gmail: https://mail.google.com/mail/u/0/#inbox/${m.id}`);

  const confidence = sources.length >= 3 ? "high" : sources.length > 0 ? "medium" : "low";

  if (!openai) {
    return {
      content: {
        title: input.meeting.title,
        summary: "[Stub] OpenAI key not set. This is a placeholder brief.",
        agenda: [],
        key_points: [],
        suggested_actions: [],
        risks: [],
      } satisfies BriefJSON,
      confidence,
      sources,
    };
  }

  const system = `You generate concise meeting briefs from user-provided context.\n- Use only the provided context.\n- If context is insufficient, say so clearly.\n- Be factual and avoid speculation.\n- Return ONLY a single JSON object, with no markdown or commentary.`;
  const user = `Meeting: ${input.meeting.title}\nStart: ${input.meeting.start ?? "unknown"}\nAttendees: ${(input.meeting.attendees || []).map(a => a.email).filter(Boolean).join(", ")}\nDescription: ${input.meeting.description ?? ""}\n\nContext:\nDrive files:\n${input.drive.map(f => `- ${f.name ?? "(untitled)"} (${f.mimeType ?? "?"}) ${f.webViewLink ?? ""}`).join("\n")}\n\nGmail snippets:\n${input.gmail.map(g => `- ${g.snippet ?? "(no snippet)"}`).join("\n")}\n\nRespond with a MINIFIED JSON object using this schema:\n{\n  "title": string,                // optional; meeting title if helpful\n  "summary": string,              // 2-5 sentences\n  "key_points": string[],         // 3-8 concise bullets\n  "suggested_actions": string[],  // 2-6 actionable bullets\n  "risks": string[]               // 0-5 bullets, may be empty\n}\nNo code fences. No extra keys.`;

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
  const content: BriefJSON = parsed ?? { text: raw };

  return {
    content,
    confidence,
    sources,
  };
}
