-- Add searchStrategy column to UserSettings for query planning strategy
ALTER TABLE "UserSettings" ADD COLUMN "searchStrategy" TEXT;

