import { NextRequest, NextResponse } from "next/server";
import { withUserLLM } from "@/lib/llm-selection";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserSettings } from "@/lib/settings";
import { parseSchedulingDirection } from "@olly/core/src/agents/personas/SchedulingAgent";

/** Parse a free-text scheduling direction into a reviewable draft. */
async function postHandler(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const direction =
    typeof body?.direction === "string" ? body.direction.trim() : "";
  if (!direction) {
    return NextResponse.json({ error: "missing_direction" }, { status: 400 });
  }

  try {
    const settings = await getUserSettings(session.user.id);
    const people = await prisma.person.findMany({
      where: { userId: session.user.id, email: { not: null } },
      select: { name: true, email: true },
      take: 200,
    });

    const parsed = await parseSchedulingDirection({
      direction,
      timeZone: settings.timeZone || "UTC",
      knownPeople: people
        .filter((p) => p.email)
        .map((p) => ({ name: p.name, email: p.email as string })),
    });

    if (!parsed) {
      return NextResponse.json(
        { error: "parse_failed", message: "Couldn't interpret that request" },
        { status: 422 },
      );
    }

    return NextResponse.json({ parsed });
  } catch (error) {
    console.error("Failed to parse scheduling direction:", error);
    return NextResponse.json({ error: "parse_failed" }, { status: 500 });
  }
}

// Run under the user's chosen LLM provider and model (Settings).
export const POST = withUserLLM(postHandler);
