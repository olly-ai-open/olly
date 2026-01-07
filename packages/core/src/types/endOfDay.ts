export type EndOfDayDocInput = {
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
};

export type EndOfDayActionItem = {
  title: string;
  dueDate?: string | null;
  link?: string | null;
  source?: string | null;
  assignee: string;
};
