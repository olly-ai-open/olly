import { runJobById } from "@olly/core";
import { initializeEnvironment } from "./init-env";

interface SQSRecord {
  messageId: string;
  body: string;
}

interface SQSEvent {
  Records: SQSRecord[];
}

// Initialize environment at module load (cold start)
const envInitPromise = initializeEnvironment();

export async function handler(event: SQSEvent): Promise<void> {
  // Ensure environment is initialized before processing
  await envInitPromise;
  const records = event.Records || [];

  for (const record of records) {
    try {
      const payload = JSON.parse(record.body) as { jobId?: string };
      if (!payload.jobId) {
        console.warn("Missing jobId in SQS message", record.messageId);
        continue;
      }
      await runJobById(payload.jobId);
    } catch (err) {
      console.error("Failed to process SQS message", record.messageId, err);
    }
  }
}
