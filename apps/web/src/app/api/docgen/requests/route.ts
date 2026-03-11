import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  createDocGenRequestCore,
  processDocGenRequestCore,
  listDocGenRequestsCore,
} from "@olly/core";

/**
 * POST /api/docgen/requests - Create a new document generation request
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const { prompt, templateId } = body;

  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "prompt_required" },
      { status: 400 },
    );
  }

  try {
    // Create the request
    const { requestId } = await createDocGenRequestCore(prisma, {
      userId: session.user.id,
      prompt: prompt.trim(),
      templateId,
    });

    // Start processing in background (non-blocking)
    processDocGenRequestCore(prisma, requestId).catch((error) => {
      console.error("DocGen processing failed:", error);
    });

    return NextResponse.json({ ok: true, requestId });
  } catch (error: any) {
    console.error("Failed to create docgen request:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "failed" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/docgen/requests - List recent document generation requests
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") || "20", 10);

  try {
    const requests = await listDocGenRequestsCore(
      prisma,
      session.user.id,
      limit,
    );
    return NextResponse.json({ ok: true, requests });
  } catch (error: any) {
    console.error("Failed to list docgen requests:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "failed" },
      { status: 500 },
    );
  }
}
