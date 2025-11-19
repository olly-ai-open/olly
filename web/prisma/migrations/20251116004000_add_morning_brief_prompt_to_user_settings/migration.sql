-- Add morningBriefSystemPrompt column to UserSettings for admin-tunable morning brief prompt
ALTER TABLE "UserSettings" ADD COLUMN "morningBriefSystemPrompt" TEXT;

