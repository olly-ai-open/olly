import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTemplatesCore, uploadTemplateCore } from "@olly/core";

/**
 * GET /api/docgen/templates - List available templates
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
  const docType = searchParams.get("docType") || undefined;

  try {
    const templates = await getTemplatesCore(prisma, session.user.id, docType);
    return NextResponse.json({ ok: true, templates });
  } catch (error: any) {
    console.error("Failed to list templates:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "failed" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/docgen/templates - Upload a new template
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
  const { name, content, docType, description, mimeType } = body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "name_required" },
      { status: 400 },
    );
  }

  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "content_required" },
      { status: 400 },
    );
  }

  if (
    !docType ||
    !["status_update", "monthly_report", "wiki", "general"].includes(docType)
  ) {
    return NextResponse.json(
      { ok: false, error: "invalid_doc_type" },
      { status: 400 },
    );
  }

  try {
    const { templateId } = await uploadTemplateCore(prisma, session.user.id, {
      name: name.trim(),
      content: content.trim(),
      docType,
      description: description?.trim(),
      mimeType,
    });
    return NextResponse.json({ ok: true, templateId });
  } catch (error: any) {
    console.error("Failed to upload template:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "failed" },
      { status: 500 },
    );
  }
}
