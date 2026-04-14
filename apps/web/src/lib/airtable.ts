import { getCredential } from "@/lib/credentials";

export async function checkAirtableHealth(userId: string): Promise<{ connected: boolean }> {
  try {
    const data = await getCredential(userId, "airtable");
    return { connected: !!data };
  } catch {
    return { connected: false };
  }
}

export async function getAirtableToken(userId: string): Promise<string | null> {
  try {
    const data = await getCredential(userId, "airtable");
    return data?.accessToken || null;
  } catch {
    return null;
  }
}