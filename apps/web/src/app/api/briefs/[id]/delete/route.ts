import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only the owner of the brief may delete it (ownership is via the meeting).
    const brief = await prisma.brief.findUnique({
      where: { id },
      select: { meeting: { select: { userId: true } } },
    });

    if (!brief) {
      return NextResponse.json({ error: "Brief not found" }, { status: 404 });
    }

    if (brief.meeting?.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Delete the brief (cascading delete will handle related records)
    await prisma.brief.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting brief:", error);
    return NextResponse.json(
      { error: "Failed to delete brief" },
      { status: 500 },
    );
  }
}
