-- Add end-of-day prompt override to user settings
ALTER TABLE "UserSettings"
ADD COLUMN "endOfDayBriefSystemPrompt" TEXT;
