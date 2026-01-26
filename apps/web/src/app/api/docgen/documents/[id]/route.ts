import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getGeneratedDocumentCore } from '@olly/core';

/**
 * GET /api/docgen/documents/[id] - Get a generated document
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
    const document = await getGeneratedDocumentCore(prisma, id, session.user.id);

    return NextResponse.json({
      ok: true,
      document: {
        id: document.id,
        title: document.title,
        docType: document.docType,
        content: document.content,
        citations: document.citations,
        openQuestions: document.openQuestions,
        savedAt: document.savedAt,
        createdAt: document.createdAt,
        request: document.request,
      },
    });
  } catch (error: any) {
    if (error.message === 'Document not found') {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    }
    console.error('Failed to get document:', error);
    return NextResponse.json(
      { ok: false, error: error?.message || 'failed' },
      { status: 500 }
    );
  }
}
