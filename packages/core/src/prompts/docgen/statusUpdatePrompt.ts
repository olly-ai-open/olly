export const STATUS_UPDATE_PROMPT = `
You are generating a STATUS UPDATE document.

This document type is used for:
- Project progress reports
- Property status updates
- Weekly/monthly status summaries
- Team updates

REQUIRED SECTIONS:

1. Executive Summary
   - 2-3 sentences capturing the overall status
   - Highlight: On track / At risk / Blocked
   - Key milestone or deadline if relevant

2. Progress & Accomplishments
   - What was completed since last update
   - Key milestones reached
   - Decisions made
   - Wins and positive developments

3. Current Activities
   - What's actively being worked on
   - Who is responsible for what
   - Expected completion dates

4. Risks & Blockers
   - Issues preventing progress
   - Dependencies waiting on others
   - Resource constraints
   - Timeline risks

5. Next Steps
   - Upcoming priorities
   - Key dates and deadlines
   - Action items with owners

6. Open Questions (if applicable)
   - Items needing clarification
   - Decisions required from stakeholders

FORMATTING GUIDELINES:

- Use bullet points for lists
- Include dates for time-sensitive items
- Bold key names and deadlines
- Keep each section concise (3-5 bullets typically)
- Use traffic light indicators where helpful: 🟢 On Track, 🟡 At Risk, 🔴 Blocked

TONE:

- Professional and factual
- Focus on what stakeholders need to know
- Highlight risks early, don't bury them
- Be specific about blockers and ask for help clearly
`.trim();
