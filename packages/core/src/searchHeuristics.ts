type GmailHeuristicsInput = {
  effectiveAttendees: string[];
  extractedNames: string[];
  titleQ?: string | null;
  gmailTimeframe: string;
  currentUserEmail?: string | null;
};

export function buildDriveHeuristicQueries(title?: string | null): string[] {
  const queries: string[] = [];
  if (!title) return queries;

  // Strategy 1: Search for the full meeting title if it's specific enough
  if (
    title.length > 8 &&
    !title.match(/^(meeting|call|sync|standup|weekly|daily|monthly)$/i)
  ) {
    queries.push(title);
  }

  // Strategy 2: Search for meaningful multi-word phrases from title
  const meaningfulPhrases: string[] = [];
  const words = title.split(/[\s\-\/]+/).filter((w) => w.length > 2);

  for (let i = 0; i < words.length - 1; i++) {
    const phrase = words.slice(i, i + 2).join(" ");
    if (
      !phrase.match(
        /^(weekly|daily|monthly|meeting|call|sync|standup|check|in)\s/i,
      ) &&
      !phrase.match(
        /\s(weekly|daily|monthly|meeting|call|sync|standup|check|in)$/i,
      )
    ) {
      meaningfulPhrases.push(phrase);
    }
  }
  queries.push(...meaningfulPhrases);

  // Strategy 3: If it's a recurring meeting, search for the base name without frequency indicators
  const baseTitle = title
    .replace(
      /\s*-\s*(weekly|daily|monthly|biweekly|standup|sync|meeting|call)\s*/gi,
      "",
    )
    .replace(
      /\s*(weekly|daily|monthly|biweekly|standup|sync|meeting|call)\s*/gi,
      "",
    )
    .trim();
  if (baseTitle && baseTitle !== title && baseTitle.length > 5) {
    queries.push(baseTitle);
  }

  return queries;
}

export function buildGmailHeuristicQueries(input: GmailHeuristicsInput): {
  queries: string[];
  usedExtractedNames: boolean;
} {
  const {
    effectiveAttendees,
    extractedNames,
    titleQ,
    gmailTimeframe,
    currentUserEmail,
  } = input;

  const queries: string[] = [];
  let usedExtractedNames = false;

  const otherAttendees = currentUserEmail
    ? effectiveAttendees.filter(
        (email) => email.toLowerCase() !== currentUserEmail.toLowerCase(),
      )
    : effectiveAttendees;

  const participantNames = otherAttendees
    .map((email) => {
      const localPart = email.split("@")[0];
      return localPart
        .replace(/[._-]/g, " ")
        .split(" ")
        .filter((part) => part.length > 1)
        .join(" ")
        .trim();
    })
    .filter((name) => name.length > 2);

  if (otherAttendees.length > 0) {
    // Strategy 1: Emails between you and other participants
    for (const otherEmail of otherAttendees.slice(0, 3)) {
      queries.push(
        `(from:${otherEmail} OR to:${otherEmail} OR cc:${otherEmail}) ${gmailTimeframe}`,
      );
    }

    // Strategy 2: Emails containing multiple OTHER participant addresses
    if (otherAttendees.length >= 2) {
      const participantEmailQuery = otherAttendees
        .slice(0, 3)
        .map((email) => `"${email}"`)
        .join(" AND ");
      queries.push(`(${participantEmailQuery}) ${gmailTimeframe}`);
    }

    // Strategy 3: Emails mentioning OTHER participants' names or email addresses in content
    if (otherAttendees.length >= 1) {
      const contentSearchTerms = [
        ...participantNames.slice(0, 3).map((name) => `"${name}"`),
        ...otherAttendees.slice(0, 3).map((email) => `"${email}"`),
      ];

      if (contentSearchTerms.length > 0) {
        const contentQuery = contentSearchTerms.join(" OR ");
        queries.push(`(${contentQuery}) ${gmailTimeframe}`);
      }
    }
  }

  // Strategy 4: Search for extracted names from solo meetings
  if (extractedNames.length > 0 && currentUserEmail) {
    const currentUserName = currentUserEmail
      .split("@")[0]
      .replace(/[._-]/g, " ");

    for (const name of extractedNames.slice(0, 3)) {
      if (name.toLowerCase() !== currentUserName.toLowerCase()) {
        queries.push(`"${name}" ${gmailTimeframe}`);
        usedExtractedNames = true;
      }
    }
  }

  // Strategy 5: Broader search with meeting title if available
  if (titleQ) {
    queries.push(`"${titleQ}" ${gmailTimeframe}`);
  }

  return { queries, usedExtractedNames };
}

export function buildSlackHeuristicQueries(input: {
  titleQ?: string | null;
  attendees?: string[];
}) {
  const queries: string[] = [];
  const { titleQ, attendees = [] } = input;

  if (titleQ && titleQ.trim().length > 4) {
    const trimmed = titleQ.trim();
    queries.push(`"${trimmed}"`);

    const words = trimmed.split(/\s+/).filter((w) => w.length > 3);
    if (words.length >= 2) {
      queries.push(words.slice(0, 3).join(" "));
    }
  }

  const attendeeNames = attendees
    .map((email) =>
      email
        .split("@")[0]
        .replace(/[._-]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((name) => name.length > 2);

  if (attendeeNames.length > 0) {
    attendeeNames.slice(0, 2).forEach((name) => queries.push(name));
    if (attendeeNames.length >= 2) {
      queries.push(attendeeNames.slice(0, 2).join(" "));
    }
  }

  const unique = Array.from(new Set(queries.map((q) => q.trim()))).filter(
    Boolean,
  );
  return unique.slice(0, 6);
}
