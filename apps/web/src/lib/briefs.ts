import { prisma } from "@/lib/prisma";

export async function getBriefForUser(params: {
  id: string;
  userId: string;
  markRead?: boolean;
}) {
  const { id, userId, markRead = true } = params;

  const brief = await prisma.brief.findUnique({
    where: { id },
    include: {
      meeting: true,
      actionItems: { include: { assignees: { include: { person: true } } } },
      people: { include: { person: true } },
    },
  });
  if (!brief || brief.meeting?.userId !== userId) {
    return null;
  }

  // Mark as read if requested and not already set
  if (markRead && !brief.readAt) {
    const readAt = new Date();
    await prisma.brief.update({
      where: { id },
      data: { readAt },
    });
    return { ...brief, readAt };
  }

  return brief;
}
