-- Minutes between automatic calendar syncs for the user.
ALTER TABLE "UserSettings" ADD COLUMN "calendarSyncIntervalMinutes" INTEGER NOT NULL DEFAULT 60;
