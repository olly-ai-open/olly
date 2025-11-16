-- Add timeZone column to UserSettings to track per-user calendar timezone
ALTER TABLE "UserSettings" ADD COLUMN "timeZone" TEXT;

