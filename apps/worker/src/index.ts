import { runJobById } from "@olly/core";

interface SQSRecord {
  messageId: string;
  body: string;
}

interface SQSEvent {
  Records: SQSRecord[];
}

export async function handler(event: SQSEvent): Promise<void> {
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
