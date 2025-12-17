import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// DELETE /api/account - Delete user data but preserve account shell for auditing
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    await prisma.$transaction(async (tx) => {
      const [meetingIds, actionItemIds, personIds] = await Promise.all([
        tx.meeting
          .findMany({
            where: { userId },
            select: { id: true },
          })
          .then((rows) => rows.map((r) => r.id)),
        tx.actionItem
          .findMany({
            where: { userId },
            select: { id: true },
          })
          .then((rows) => rows.map((r) => r.id)),
        tx.person
          .findMany({
            where: { userId },
            select: { id: true },
          })
          .then((rows) => rows.map((r) => r.id)),
      ]);

      if (actionItemIds.length) {
        await tx.actionItemAssignee.deleteMany({
          where: { actionItemId: { in: actionItemIds } },
        });
      }

      if (personIds.length) {
        await tx.briefParticipant.deleteMany({
          where: { personId: { in: personIds } },
        });
      }

      if (meetingIds.length) {
        await tx.meetingParticipant.deleteMany({
          where: { meetingId: { in: meetingIds } },
        });
        await tx.brief.deleteMany({
          where: { meetingId: { in: meetingIds } },
        });
      }

      if (actionItemIds.length) {
        await tx.actionItem.deleteMany({
          where: { id: { in: actionItemIds } },
        });
      }

      if (personIds.length) {
        await tx.person.deleteMany({
          where: { id: { in: personIds } },
        });
      }

      if (meetingIds.length) {
        await tx.meeting.deleteMany({
          where: { id: { in: meetingIds } },
        });
      }

      await Promise.all([
        tx.cachedArtifact.deleteMany({ where: { userId } }),
        tx.driveFolder.deleteMany({ where: { userId } }),
        tx.integration.deleteMany({ where: { userId } }),
        tx.schedule.deleteMany({ where: { userId } }),
        tx.job.deleteMany({ where: { userId } }),
        tx.userSettings.deleteMany({ where: { userId } }),
        tx.account.deleteMany({ where: { userId } }),
        tx.session.deleteMany({ where: { userId } }),
      ]);

      await tx.user.update({
        where: { id: userId },
        data: {
          preferences: Prisma.JsonNull,
          deletedAt: new Date(),
          image: null,
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete account data", error);
    return NextResponse.json(
      { error: "failed_to_delete_account" },
      { status: 500 },
    );
  }
}
