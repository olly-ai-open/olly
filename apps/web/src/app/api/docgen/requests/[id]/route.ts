import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getDocGenRequestCore } from '@olly/core';

/**
 * GET /api/docgen/requests/[id] - Get request status and document
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    const { request, document } = await getDocGenRequestCore(
      prisma,
      id,
      session.user.id
    );

    return NextResponse.json({
      ok: true,
      request: {
        id: request.id,
        prompt: request.prompt,
        intent: request.intent,
        status: request.status,
        progress: request.progress,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
        template: request.template,
        runs: request.runs,
      },
      document: document
        ? {
            id: document.id,
            title: document.title,
            docType: document.docType,
            content: document.content,
            citations: document.citations,
            openQuestions: document.openQuestions,
            savedAt: document.savedAt,
            createdAt: document.createdAt,
          }
        : null,
    });
  } catch (error: any) {
    if (error.message === 'Request not found') {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    }
    console.error('Failed to get docgen request:', error);
    return NextResponse.json(
      { ok: false, error: error?.message || 'failed' },
      { status: 500 }
    );
  }
}
