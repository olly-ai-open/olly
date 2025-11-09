import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getAccessTokenFromAccount,
  getEventDetailsWithToken,
  searchDriveSnippets,
  searchGmailSnippets,
} from "@/lib/google";
import { generateBriefFromContext } from "@/lib/llm";
import { upsertMeetingFromEvent } from "@/lib/meetings";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import {
  linkBriefParticipants,
  linkMeetingParticipants,
  upsertPersonsForEmails,
} from "@/lib/people";

const MAX_PARTICIPANTS = 10;
const DEBUG = false;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  let eventId: string | undefined;
  let wantsRedirect = false;
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    eventId = body?.eventId as string | undefined;
    wantsRedirect = Boolean(body?.redirect);
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData();
    eventId = (form.get("eventId") as string) || undefined;
    wantsRedirect = (form.get("redirect") as string) === "1";
  }
  if (!eventId)
    return NextResponse.json(
      { ok: false, error: "missing eventId" },
      { status: 400 },
    );

  try {
    const account = await prisma.account.findFirst({
      where: { userId: session.user.id, provider: "google" },
    });
    if (!account)
      return NextResponse.json(
        { ok: false, error: "no_account" },
        { status: 404 },
      );
    const token = await getAccessTokenFromAccount(account);
    const event = await getEventDetailsWithToken(token, eventId);
    const userId = session.user.id;
    const meeting = await upsertMeetingFromEvent(userId, event);

    const titleQ = event.title
      ?.split(/\s+/)
      .slice(0, MAX_PARTICIPANTS)
      .join(" ");
    const attendees = ((event.attendees || []) as { email?: string | null }[])
      .map((a) => a.email)
      .filter(Boolean) as string[];

    // Check user's Drive access preference
    const integration = await prisma.integration.findFirst({
      where: { userId, provider: "google_workspace" },
      select: { meta: true },
    });

    const driveAccess = (integration?.meta as any)?.driveAccess || "folders";

    if (DEBUG) {
      console.log(`Meeting: "${event.title}"`);
      console.log(`Attendees: [${attendees.join(", ")}]`);
      console.log(`Drive access mode: ${driveAccess}`);
    }

    if (driveAccess === "folders") {
      const allowedFolders = await prisma.driveFolder.findMany({
        where: { userId },
        select: { folderId: true, folderName: true },
      });
      if (DEBUG) {
        console.log(`Available Drive folders: ${allowedFolders.length}`);
        if (allowedFolders.length > 0) {
          console.log(
            `Folder names: [${allowedFolders.map((f) => f.folderName).join(", ")}]`,
          );
        }
      }
    }

    // For Drive: search based on access mode
    let drive: any[] = [];
    const driveQueries = [
      titleQ,
      event.title,
      // Try searching for keywords from the title
      ...(event.title?.split(/\s+/).filter((word) => word.length > 3) || []),
    ].filter(Boolean);

    if (DEBUG) {
      console.log(`Drive search queries: [${driveQueries.join(", ")}]`);
    }

    // Try each query until we get results
    for (const query of driveQueries) {
      drive = await searchDriveSnippets(userId, query);
      if (DEBUG) {
        console.log(`Drive query "${query}": ${drive.length} results`);
      }
      if (drive.length > 0) break;
    }

    // For Gmail: search for emails BETWEEN meeting participants
    let gmail: any[] = [];
    if (attendees.length > 0) {
      const gmailQueries = [];

      // Build queries for emails between participants
      if (attendees.length >= 2) {
        // For each participant, find emails they sent TO other participants
        for (const fromEmail of attendees.slice(0, 3)) {
          const otherAttendees = attendees.filter(
            (email) => email !== fromEmail,
          );
          if (otherAttendees.length > 0) {
            const toQuery = otherAttendees
              .slice(0, 3)
              .map((email) => `to:${email}`)
              .join(" OR ");
            gmailQueries.push(`from:${fromEmail} (${toQuery}) newer_than:30d`);

            // Also try with subject if available
            if (titleQ) {
              gmailQueries.push(
                `from:${fromEmail} (${toQuery}) subject:"${titleQ}" newer_than:30d`,
              );
            }
          }
        }

        // Fallback: emails containing multiple participant addresses in any field
        const participantQuery = attendees
          .slice(0, 3)
          .map((email) => `"${email}"`)
          .join(" AND ");
        gmailQueries.push(`(${participantQuery}) newer_than:30d`);
      } else {
        // Single participant fallback (shouldn't happen in meetings, but just in case)
        gmailQueries.push(`from:${attendees[0]} newer_than:30d`);
      }

      // Try broader search with title if nothing else works
      if (titleQ) {
        gmailQueries.push(`"${titleQ}" newer_than:30d`);
      }

      if (DEBUG) {
        console.log(
          `Gmail search queries (between participants): [${gmailQueries.join("; ")}]`,
        );
      }

      // Try each query until we get results
      for (const query of gmailQueries) {
        gmail = await searchGmailSnippets(userId, query);
        if (DEBUG) {
          console.log(`Gmail query "${query}": ${gmail.length} results`);
        }
        if (gmail.length > 0) break;
      }
    } else {
      if (DEBUG) {
        console.log("No attendees found - trying title-only Gmail search");
      }
      if (titleQ) {
        gmail = await searchGmailSnippets(userId, `"${titleQ}" newer_than:30d`);
        if (DEBUG) {
          console.log(`Gmail title search: ${gmail.length} results`);
        }
      }
    }

    if (DEBUG) {
      console.log(
        `Final results - Drive: ${drive.length}, Gmail: ${gmail.length}`,
      );
    }

    const brief = await generateBriefFromContext({
      meeting: {
        title: event.title,
        start: event.start,
        attendees: event.attendees,
        description: event.description,
      },
      drive,
      gmail,
    });

    const saved = await prisma.brief.create({
      data: {
        meetingId: meeting.id,
        content: brief.content as any,
        confidence: brief.confidence,
        sources: brief.sources as any,
      },
    });

    // People: upsert Person rows for attendees, and link to meeting/brief
    const personRows = await upsertPersonsForEmails(
      userId,
      ((event.attendees || []) as { email?: string | null }[]).map(
        (a) => a.email,
      ),
    );
    const personIds = personRows.map((p: any) => p.id);
    await linkMeetingParticipants(meeting.id, personIds);
    await linkBriefParticipants(saved.id, personIds);

    // Create ActionItems from structured response
    const content: any = saved.content as any;
    const items: any[] = Array.isArray(content?.action_items)
      ? content.action_items
      : Array.isArray(content?.suggested_actions)
        ? (content.suggested_actions as string[]).map((s) => ({
            description: s,
          }))
        : [];
    if (items.length) {
      const toCreate = items.slice(0, 20).map((it) => ({
        userId,
        title:
          String(it?.description ?? it?.title ?? "").slice(0, 280) ||
          "Untitled",
        briefId: saved.id,
        status: "open",
        priority: typeof it?.priority === "string" ? it.priority : undefined,
        dueAt:
          it?.due_date && !isNaN(Date.parse(it.due_date))
            ? new Date(it.due_date as string)
            : undefined,
      }));
      await prisma.actionItem.createMany({ data: toCreate });
    }

    // Revalidate dashboard; detail page is a fresh navigation
    try {
      revalidatePath("/");
    } catch {}

    if (wantsRedirect) {
      const url = new URL(`/briefs/${saved.id}`, req.url);
      url.searchParams.set("t", Date.now().toString());
      return NextResponse.redirect(url);
    }
    return NextResponse.json({ ok: true, brief: saved });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "failed" },
      { status: 500 },
    );
  }
}
