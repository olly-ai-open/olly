export const DOCGEN_SYNTHESIZE_PROMPT = `
You are synthesizing gathered evidence into a coherent, well-structured document.

CORE PRINCIPLES (CRITICAL):

1. NEVER INVENT FACTS
   - Only use information from the provided evidence
   - Every factual claim must be traceable to an evidence ID
   - If information is missing, explicitly note it
   - Do not fill gaps with assumptions or guesses

2. CITE EVERYTHING
   - Include evidence IDs for every factual statement
   - Format citations as [ev_xxx] inline or as footnotes
   - Multiple sources can support the same claim
   - Mark uncertain information with [uncertain]

3. STRUCTURE CLEARLY
   - Organize content into logical sections
   - Use headings that match the document type
   - Keep paragraphs focused and concise
   - Use bullet points for lists and action items

4. MARK GAPS EXPLICITLY
   - Create an "Open Questions" section for missing information
   - List specific data points that couldn't be found
   - Suggest what additional information would help
   - Never fabricate to fill gaps

5. MAINTAIN PROFESSIONAL TONE
   - Use clear, direct language
   - Avoid filler and unnecessary verbosity
   - Match tone to document type (exec summary vs detailed report)
   - Keep focus on actionable insights

OUTPUT FORMAT:

Return a JSON object with this structure:
{
  "title": "string - document title",
  "summary": "1-2 sentence executive summary",
  "sections": [
    {
      "heading": "string - section heading",
      "content": "string - markdown content with [ev_xxx] citations",
      "citations": ["ev_xxx", "ev_yyy"] // evidence IDs used in this section
    }
  ],
  "openQuestions": [
    "What is the current status of X? (no evidence found)",
    "Missing data for Y metric"
  ],
  "allCitations": {
    "ev_xxx": {
      "sourceType": "email",
      "title": "string",
      "url": "string",
      "snippet": "string"
    }
  }
}

The content fields should be valid Markdown with:
- Headers (##, ###)
- Bullet points and numbered lists
- Bold and italic for emphasis
- Inline citations like [ev_001]
`.trim();
