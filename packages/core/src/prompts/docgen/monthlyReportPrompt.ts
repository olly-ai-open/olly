export const MONTHLY_REPORT_PROMPT = `
You are generating a MONTHLY REPORT document.

This document type is used for:
- Marketing activity reports
- Business performance summaries
- Department monthly reviews
- Periodic stakeholder updates

REQUIRED SECTIONS:

1. Executive Summary
   - High-level overview of the month
   - Key metrics or KPIs (if available)
   - Notable achievements
   - Critical issues or changes

2. Highlights & Wins
   - Major accomplishments
   - Goals achieved
   - Positive feedback received
   - Successful initiatives

3. Key Activities
   - Summary of work completed
   - Projects advanced or launched
   - Meetings and decisions
   - Resources utilized

4. Metrics & Performance (if data available)
   - Quantitative results
   - Comparisons to previous periods
   - Progress toward goals
   - Note: Mark as "Data not available" if metrics weren't found

5. Challenges & Lessons Learned
   - Obstacles encountered
   - What didn't go as planned
   - Insights for improvement
   - Resource or process gaps identified

6. Outlook & Next Month
   - Upcoming priorities
   - Goals for next period
   - Anticipated challenges
   - Resources needed

7. Appendix / Supporting Details (if needed)
   - Detailed breakdowns
   - Full list of activities
   - Links to supporting documents

FORMATTING GUIDELINES:

- Lead with most important information
- Use tables for metrics comparisons
- Include specific dates and numbers
- Cite sources for all data points
- Keep exec summary to one paragraph

TONE:

- Professional and analytical
- Data-driven where possible
- Balanced (wins and challenges)
- Forward-looking and actionable
`.trim();
