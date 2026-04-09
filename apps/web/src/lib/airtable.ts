export async function checkAirtableHealth(userId: string): Promise<{ connected: boolean }> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const credential = await prisma.airtableCredential.findUnique({
      where: { userId },
    });
    return { connected: !!credential };
  } catch {
    return { connected: false };
  }
}
