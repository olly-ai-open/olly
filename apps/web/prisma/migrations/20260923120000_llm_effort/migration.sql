-- Per-user reasoning effort hint for models that support it. Null means the provider default.
ALTER TABLE "UserSettings" ADD COLUMN "llmEffort" TEXT;
