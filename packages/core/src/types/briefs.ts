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

export type MorningBriefJSON = {
  brief_markdown: string;
  highlighted_action_item_ids?: string[];
};
