export const END_OF_DAY_BRIEF_PROMPT = `
You are generating an "End of day summary" for the user.

Focus:
- Consider documents updated within the requested window ending at the brief time.
- Prefer cleaned summaries when both raw notes and cleaned versions exist; fall back to raw when no cleaned version is available.
- Ignore boilerplate or system-generated noise.

Sections (in order):
1) Highlights & Decisions
2) Risks & Blockers
3) Action Items
   - Assign all items to the user.
   - Include due date if present; otherwise note "No due date".
4) Notable Docs
   - Title + link per doc.

Output:
- Be concise and use bullet points.
- If a section has no content, output "None."
- Do not invent facts not present in the documents.
`.trim();
