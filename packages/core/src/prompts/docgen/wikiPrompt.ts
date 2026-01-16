export const WIKI_PROMPT = `
You are generating a WIKI document from conversations and discussions.

This document type is used for:
- Synthesizing discussions into knowledge articles
- Creating documentation from scattered conversations
- Building institutional knowledge
- Topic summaries and how-to guides

REQUIRED SECTIONS:

1. Overview
   - What this document covers
   - Why it matters
   - Who should read it

2. Background / Context
   - How this topic emerged
   - Related decisions or events
   - Key stakeholders involved

3. Key Information
   - Core facts and details
   - Important definitions
   - Critical requirements or constraints

4. Decisions Made
   - What was decided and when
   - Who made the decisions
   - Rationale behind decisions
   - Any dissenting views or alternatives considered

5. Current State
   - What's true as of now
   - Active processes or policies
   - Who is responsible for what

6. How-To / Process (if applicable)
   - Step-by-step instructions
   - Best practices
   - Common pitfalls to avoid

7. Related Resources
   - Links to source conversations
   - Related documents
   - People to contact for more info

8. Open Questions / TBD
   - Items still being discussed
   - Decisions pending
   - Areas needing more research

FORMATTING GUIDELINES:

- Use clear headings and subheadings
- Include a table of contents for longer docs
- Use callout boxes for important notes
- Cross-reference related sections
- Date-stamp time-sensitive information
- Include "Last Updated" date prominently

TONE:

- Neutral and informative
- Easy to scan and reference
- Authoritative but not rigid
- Acknowledge uncertainty where present

SPECIAL RULES FOR WIKI:

- Synthesize, don't just summarize
- Connect related ideas across sources
- Highlight contradictions or evolving opinions
- Preserve important nuances
- Make it useful as a reference document
`.trim();
