export async function checkAirtableHealth(userId: string): Promise<{ connected: boolean }> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const credential = await prisma.integration.findFirst({
      where: { userId, provider: "airtable", status: "connected" },
    });
    return { connected: !!credential };
  } catch {
    return { connected: false };
  }
}
