-- Minutes before a meeting starts that its brief is generated and emailed.
ALTER TABLE "UserSettings" ADD COLUMN "meetingBriefLeadMinutes" INTEGER NOT NULL DEFAULT 5;
