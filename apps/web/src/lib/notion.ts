import { getCredential, hasCredential } from "@/lib/credentials";

export async function checkNotionHealth(
  userId: string,
): Promise<{ connected: boolean }> {
  try {
    const connected = await hasCredential(userId, "notion");
    return { connected };
  } catch {
    return { connected: false };
  }
}

export async function getNotionToken(userId: string): Promise<string | null> {
  try {
    const data = await getCredential(userId, "notion");
    return data?.accessToken || null;
  } catch {
    return null;
  }
}
