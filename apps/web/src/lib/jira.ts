import { getCredential, hasCredential } from "@/lib/credentials";

export async function checkJiraHealth(userId: string): Promise<{ connected: boolean; baseUrl?: string }> {
  try {
    const data = await getCredential(userId, "jira");
    return {
      connected: !!data,
      baseUrl: data?.baseUrl,
    };
  } catch {
    return { connected: false };
  }
}

export async function getJiraCredentials(userId: string): Promise<{ accessToken: string; baseUrl: string; email: string } | null> {
  try {
    const data = await getCredential(userId, "jira");
    if (!data?.accessToken || !data?.baseUrl || !data?.email) return null;
    return {
      accessToken: data.accessToken,
      baseUrl: data.baseUrl,
      email: data.email,
    };
  } catch {
    return null;
  }
}