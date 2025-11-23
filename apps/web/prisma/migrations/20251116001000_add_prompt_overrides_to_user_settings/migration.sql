-- Add prompt override columns to UserSettings for admin-tunable LLM prompts
ALTER TABLE "UserSettings" ADD COLUMN "briefSystemPrompt" TEXT;
ALTER TABLE "UserSettings" ADD COLUMN "queryPlannerSystemPrompt" TEXT;

