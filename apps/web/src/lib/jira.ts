export async function checkJiraHealth(userId: string): Promise<{ connected: boolean; baseUrl?: string }> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const integration = await prisma.integration.findFirst({
      where: {
        userId,
        provider: "jira",
        status: "connected",
      },
    });
    const meta = integration?.meta as any;
    return {
      connected: !!integration,
      baseUrl: meta?.baseUrl,
    };
  } catch {
    return { connected: false };
  }
}

export async function getJiraCredentials(userId: string): Promise<{ accessToken: string; baseUrl: string; email: string } | null> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const integration = await prisma.integration.findFirst({
      where: {
        userId,
        provider: "jira",
        status: "connected",
      },
    });
    if (!integration?.meta) return null;
    const meta = integration.meta as any;
    if (!meta.accessToken || !meta.baseUrl || !meta.email) return null;
    return {
      accessToken: meta.accessToken,
      baseUrl: meta.baseUrl,
      email: meta.email,
    };
  } catch {
    return null;
  }
}