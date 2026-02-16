/**
 * Strip leaked Prisma cuid IDs from brief markdown.
 * Matches patterns like "(cmjchyxg3000bl5027p07ropv)" that the LLM
 * sometimes includes despite prompt instructions.
 */
export function sanitizeBriefMarkdown(markdown: string): string {
  return markdown.replace(/\s*\(cm[a-z0-9]{20,30}\)/g, "");
}

export type MeetingBriefSections = {
  /** Card 1: Meeting Overview section */
  overview: string | null;
  /** Card 2: Context & Background + Key Points + Suggested Talking Points */
  contextAndPoints: string | null;
  /** Full original markdown (fallback) */
  fullMarkdown: string;
};

type MarkdownSection = {
  heading: string;
  headingNormalized: string;
  content: string;
};

const OVERVIEW_PATTERNS = ["meeting overview"];
const CONTEXT_PATTERNS = [
  "context & background",
  "context and background",
  "key points to recall",
  "suggested talking points",
];
const EXCLUDED_PATTERNS = ["goals", "relevant documents"];

function splitMarkdownBySections(markdown: string): MarkdownSection[] {
  const lines = markdown.split("\n");
  const sections: MarkdownSection[] = [];
  let currentHeading: string | null = null;
  let currentLines: string[] = [];
  let preambleLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^##\s*(.*)/);
    if (match) {
      if (currentHeading !== null) {
        sections.push({
          heading: currentHeading,
          headingNormalized: currentHeading.toLowerCase().trim(),
          content: currentLines.join("\n").trim(),
        });
      } else if (currentLines.length > 0) {
        preambleLines = [...currentLines];
      }
      currentHeading = match[1].trim();
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  if (currentHeading !== null) {
    sections.push({
      heading: currentHeading,
      headingNormalized: currentHeading.toLowerCase().trim(),
      content: currentLines.join("\n").trim(),
    });
  }

  if (preambleLines.length > 0 && sections.length > 0) {
    sections[0].content =
      preambleLines.join("\n").trim() + "\n\n" + sections[0].content;
  }

  return sections;
}

export type ParsedOverview = {
  /** Overview content without title or attendees (as markdown) */
  mainContent: string;
  /** Attendees line(s) for collapsible display */
  attendees: string | null;
};

const BULLET_RE = /^[\s]*[-*•⁠]\s*/;

/** A top-level bullet has no leading whitespace before the marker */
function isTopLevelBullet(line: string): boolean {
  return /^[-*•⁠]\s*/.test(line);
}

function isBulletLine(line: string): boolean {
  return BULLET_RE.test(line);
}

export function parseOverviewContent(overviewMarkdown: string): ParsedOverview {
  const lines = overviewMarkdown.split("\n");
  const mainLines: string[] = [];
  const attendeeLines: string[] = [];
  let collectingAttendees = false;

  for (const line of lines) {
    const lower = line.toLowerCase();
    const isTopBullet = isTopLevelBullet(line);

    // A new top-level bullet ends attendee collection (unless it IS the attendee bullet)
    if (
      isTopBullet &&
      !lower.includes("attendee") &&
      !lower.includes("participant")
    ) {
      collectingAttendees = false;
    }

    // Skip title bullets
    if (
      isTopBullet &&
      (lower.includes("meeting title") ||
        lower.match(/^[-*•⁠]\s*\*{0,2}title\*{0,2}\s*[:：]/))
    ) {
      continue;
    }

    // Separate attendee bullets
    if (
      isTopBullet &&
      (lower.includes("attendee") || lower.includes("participant"))
    ) {
      attendeeLines.push(line);
      collectingAttendees = true;
      continue;
    }

    // Sub-items or continuation lines under the attendee bullet
    if (collectingAttendees && !isTopBullet && line.trim()) {
      attendeeLines.push(line);
      continue;
    }

    mainLines.push(line);
  }

  return {
    mainContent: mainLines.join("\n").trim(),
    attendees: attendeeLines.length > 0 ? attendeeLines.join("\n").trim() : null,
  };
}

export function parseMeetingBriefSections(
  markdown: string,
): MeetingBriefSections {
  const sections = splitMarkdownBySections(markdown);

  if (sections.length === 0) {
    return { overview: null, contextAndPoints: null, fullMarkdown: markdown };
  }

  const overviewParts: string[] = [];
  const contextParts: string[] = [];

  for (const section of sections) {
    const norm = section.headingNormalized;

    if (OVERVIEW_PATTERNS.some((p) => norm.includes(p))) {
      overviewParts.push(section.content);
    } else if (CONTEXT_PATTERNS.some((p) => norm.includes(p))) {
      contextParts.push(section.content);
    } else if (EXCLUDED_PATTERNS.some((p) => norm.includes(p))) {
      // Skip: rendered by dedicated cards
    } else {
      // Unknown sections go to Card 2 so nothing is lost
      contextParts.push(section.content);
    }
  }

  return {
    overview: overviewParts.length > 0 ? overviewParts.join("\n\n") : null,
    contextAndPoints: contextParts.length > 0 ? contextParts.join("\n\n") : null,
    fullMarkdown: markdown,
  };
}
