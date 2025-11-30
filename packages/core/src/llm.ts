import OpenAI from "openai";
import { MEETING_BRIEF_PROMPT } from "./prompts/meetingBriefPrompt";
import { MORNING_BRIEF_PROMPT } from "./prompts/morningBriefPrompt";
import { END_OF_DAY_BRIEF_PROMPT } from "./prompts/endOfDayBriefPrompt";
import { QUERY_PLANNER_PROMPT } from "./prompts/queryPlannerPrompt";

export function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

export type BriefJSON = {
  brief_markdown: string;
  goals?: string[];
  // Legacy: kept for backwards compatibility but no longer used for new meeting briefs
  action_items?: Array<{
    description: string;
    assignee?: string | null;
    due_date?: string | null;
    priority?: "high" | "medium" | "low" | string | null;
  }>;
  key_context?: Array<string>;
};

function safeParseBriefJSON(s: string): BriefJSON | null {
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

type MorningBriefJSON = {
  brief_markdown: string;
  highlighted_action_item_ids?: string[];
};

function safeParseMorningBriefJSON(s: string): MorningBriefJSON | null {
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

export interface EndOfDayDocInput {
  id: string;
  title: string;
  source: string;
  updatedAt: string;
  link?: string | null;
  docType?: string | null;
  tags?: string[];
  meetingId?: string | null;
  isCleanedSummary?: boolean | null;
  summaryOfId?: string | null;
  text: string;
}

export interface EndOfDayActionItem {
  title: string;
  dueDate?: string | null;
  link?: string | null;
  source?: string | null;
  assignee: string;
}

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

function safeParseEndOfDaySummaryJSON(
  s: string,
): EndOfDaySummaryJSON | null {
  try {
    return JSON.parse(s) as EndOfDaySummaryJSON;
  } catch {}
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const sub = s.slice(first, last + 1);
    try {
      return JSON.parse(sub) as EndOfDaySummaryJSON;
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
      attachments?: {
        id?: string | null;
        filename?: string | null;
        mimeType?: string | null;
        size?: number | null;
        textContent?: string | null;
      }[];
    }[];
  },
  opts?: { systemPromptOverride?: string },
) {
  const openai = getOpenAI();
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

  const confidence =
    sources.length >= 3 ? "high" : sources.length > 0 ? "medium" : "low";

  if (!openai) {
    const placeholderContent = `# Meeting Brief\n\n_No OpenAI key configured. Placeholder brief for:_ ${input.meeting.title}`;
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
    goals: [],
    key_context: [],
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

  const system =
    opts?.systemPromptOverride && opts.systemPromptOverride.trim().length
      ? opts.systemPromptOverride
      : QUERY_PLANNER_PROMPT;

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

export async function generateMorningBrief(
  input: {
    day: string; // YYYY-MM-DD (local day)
    timeZone: string;
    meetings: {
      id: string;
      title: string;
      start?: string | null;
      goals?: string[];
    }[];
    actionItems: {
      id: string;
      title: string;
      dueAt?: string | null;
      status?: string | null;
      relatedMeetings?: string[];
      relatedPeople?: { name?: string | null; email?: string | null }[];
    }[];
  },
  opts?: { systemPromptOverride?: string },
): Promise<{
  brief_markdown: string;
  highlightedActionItemIds: string[];
  llmContext: {
    systemPrompt: string;
    userPrompt: string;
    response: string;
    model: string;
    temperature: number;
  };
}> {
  const openai = getOpenAI();
  if (!openai) {
    const placeholder = `# Morning Brief\n\n_No OpenAI key configured. Placeholder morning brief for ${input.day} in ${input.timeZone}._`;
    return {
      brief_markdown: placeholder,
      highlightedActionItemIds: [],
      llmContext: {
        systemPrompt: "No OpenAI key configured",
        userPrompt: `Placeholder morning brief for: ${input.day}`,
        response: placeholder,
        model: "none",
        temperature: 0,
      },
    };
  }

  const system =
    opts?.systemPromptOverride && opts.systemPromptOverride.trim().length
      ? opts.systemPromptOverride
      : MORNING_BRIEF_PROMPT;

  const meetingsBlock =
    input.meetings.length === 0
      ? "None"
      : input.meetings
          .map((m) => {
            const goals =
              Array.isArray(m.goals) && m.goals.length
                ? `\n    Goals:\n${m.goals
                    .slice(0, 5)
                    .map((g) => `      - ${g}`)
                    .join("\n")}`
                : "";
            return `- [${m.id}] ${m.title}${
              m.start ? ` @ ${m.start}` : ""
            }${goals}`;
          })
          .join("\n");

  const actionItemsBlock =
    input.actionItems.length === 0
      ? "None"
      : input.actionItems
          .map((ai) => {
            const relMeetings =
              Array.isArray(ai.relatedMeetings) && ai.relatedMeetings.length
                ? ` meetings: ${ai.relatedMeetings.join(", ")}`
                : "";
            const relPeople =
              Array.isArray(ai.relatedPeople) && ai.relatedPeople.length
                ? ` people: ${ai.relatedPeople
                    .map((p) => p.name || p.email || "")
                    .filter(Boolean)
                    .join(", ")}`
                : "";
            const metaParts = [relMeetings, relPeople]
              .map((s) => s.trim())
              .filter(Boolean);
            const meta =
              metaParts.length || ai.dueAt || ai.status
                ? ` (${[
                    ai.dueAt ? `due: ${ai.dueAt}` : "",
                    ai.status ? `status: ${ai.status}` : "",
                    ...metaParts,
                  ]
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .join("; ")})`
                : "";
            // Note: include the internal ID in a machine-readable way,
            // but the prompt instructs the model not to surface these IDs
            // in the human-facing brief_markdown.
            return `- ${ai.title}${meta} (ID: ${ai.id})`;
          })
          .join("\n");

  const user = [
    `Day: ${input.day}`,
    `Time zone: ${input.timeZone}`,
    "",
    "Meetings today:",
    meetingsBlock,
    "",
    "Candidate action items:",
    actionItemsBlock,
  ].join("\n");

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: parseFloat(process.env.OPENAI_TEMPERATURE ?? "0.2"),
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  const parsed = safeParseMorningBriefJSON(raw);
  const brief: MorningBriefJSON = parsed ?? {
    brief_markdown: raw,
    highlighted_action_item_ids: [],
  };

  const highlightedIds = Array.isArray(brief.highlighted_action_item_ids)
    ? brief.highlighted_action_item_ids.filter(
        (x) => typeof x === "string" && x.trim(),
      )
    : [];

  return {
    brief_markdown: brief.brief_markdown,
    highlightedActionItemIds: highlightedIds,
    llmContext: {
      systemPrompt: system,
      userPrompt: user,
      response: raw,
      model: process.env.OPENAI_MODEL || "gpt-4.1",
      temperature: parseFloat(process.env.OPENAI_TEMPERATURE ?? "0.2"),
    },
  };
}

export async function generateEndOfDaySummary(opts: {
  briefTime: string; // ISO string or human readable time for the run
  windowHours: number;
  documents: EndOfDayDocInput[];
  assigneeLabel?: string; // defaults to "user"
  systemPromptOverride?: string;
}): Promise<{
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
  const openai = getOpenAI();
  const assigneeLabel = opts.assigneeLabel || "user";

  if (!openai) {
    const placeholder = `End of day summary placeholder (no OpenAI key). Time: ${opts.briefTime}, window: last ${opts.windowHours}h. Docs: ${opts.documents.length}.`;
    return {
      highlights: [],
      risks: [],
      actionItems: [],
      docs: opts.documents
        .slice(0, 10)
        .map((d) => ({ title: d.title, link: d.link ?? null, source: d.source })),
      llmContext: {
        systemPrompt: "No OpenAI key configured",
        userPrompt: `Placeholder end of day summary for ${opts.briefTime}`,
        response: placeholder,
        model: "none",
        temperature: 0,
      },
    };
  }

  const systemBase =
    opts.systemPromptOverride && opts.systemPromptOverride.trim().length
      ? opts.systemPromptOverride
      : END_OF_DAY_BRIEF_PROMPT;
  const system = `${systemBase}

Output format:
- Return ONLY a single MINIFIED JSON object with these keys:
{
  "highlights": string[],
  "risks": string[],
  "action_items": [
    {
      "title": string,
      "due_date": string | null,
      "link": string | null,
      "source": string | null,
      "assignee": string
    }
  ],
  "docs": [
    {
      "title": string,
      "link": string | null,
      "source": string | null
    }
  ]
}
- No markdown fences. No commentary outside the JSON.`;

  const docList =
    opts.documents.length === 0
      ? "None"
      : opts.documents
          .map((d, idx) => {
            const metaParts = [
              `source: ${d.source}`,
              `updatedAt: ${d.updatedAt}`,
              d.docType ? `type: ${d.docType}` : "",
              d.meetingId ? `meetingId: ${d.meetingId}` : "",
              d.isCleanedSummary ? "cleaned summary: yes" : "",
              d.summaryOfId ? `summaryOfId: ${d.summaryOfId}` : "",
              Array.isArray(d.tags) && d.tags.length
                ? `tags: ${d.tags.join(", ")}`
                : "",
              d.link ? `link: ${d.link}` : "",
            ]
              .map((p) => p.trim())
              .filter(Boolean)
              .join("; ");
            return [
              `${idx + 1}. ${d.title} (${metaParts})`,
              `Content:\n${d.text}`,
            ].join("\n");
          })
          .join("\n\n");

  const userPrompt = [
    `Brief time: ${opts.briefTime}`,
    `Window: last ${opts.windowHours} hours ending at brief time`,
    `Assign all action items to: ${assigneeLabel}`,
    "",
    "Documents:",
    docList,
    "",
    "Return only the JSON object described in the system prompt.",
  ].join("\n");

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1",
    messages: [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ],
    temperature: parseFloat(process.env.OPENAI_TEMPERATURE ?? "0.2"),
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  const parsed = safeParseEndOfDaySummaryJSON(raw);

  const highlights = Array.isArray(parsed?.highlights)
    ? parsed!.highlights.filter((v) => typeof v === "string" && v.trim())
    : [];
  const risks = Array.isArray(parsed?.risks)
    ? parsed!.risks.filter((v) => typeof v === "string" && v.trim())
    : [];

  const actionItems =
    Array.isArray(parsed?.action_items) && parsed.action_items.length
      ? parsed.action_items
          .map((ai) => ({
            title: (ai?.title ?? "").trim(),
            dueDate:
              ai?.due_date && typeof ai.due_date === "string"
                ? ai.due_date
                : null,
            link:
              ai?.link && typeof ai.link === "string" && ai.link.trim()
                ? ai.link
                : null,
            source:
              ai?.source && typeof ai.source === "string" && ai.source.trim()
                ? ai.source
                : null,
            assignee:
              ai?.assignee && typeof ai.assignee === "string" && ai.assignee.trim()
                ? ai.assignee
                : assigneeLabel,
          }))
          .filter((ai) => ai.title.length > 0)
      : [];

  const docs =
    Array.isArray(parsed?.docs) && parsed.docs.length
      ? parsed.docs
          .map((d) => ({
            title: (d?.title ?? "").trim(),
            link:
              d?.link && typeof d.link === "string" && d.link.trim()
                ? d.link
                : null,
            source:
              d?.source && typeof d.source === "string" && d.source.trim()
                ? d.source
                : null,
          }))
          .filter((d) => d.title.length > 0)
      : opts.documents.slice(0, 10).map((d) => ({
          title: d.title,
          link: d.link ?? null,
          source: d.source,
        }));

  return {
    highlights,
    risks,
    actionItems,
    docs,
    llmContext: {
      systemPrompt: system,
      userPrompt,
      response: raw,
      model: process.env.OPENAI_MODEL || "gpt-4.1",
      temperature: parseFloat(process.env.OPENAI_TEMPERATURE ?? "0.2"),
    },
  };
}
