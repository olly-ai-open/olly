-- Per-user LLM provider and model. Null means "use the deployment default".
ALTER TABLE "UserSettings" ADD COLUMN "llmProvider" TEXT;
ALTER TABLE "UserSettings" ADD COLUMN "llmModel" TEXT;
