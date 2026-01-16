import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { saveGeneratedDocumentCore } from '@olly/core';

/**
 * POST /api/docgen/documents/[id]/save - Save (persist) a generated document
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    await saveGeneratedDocumentCore(prisma, id, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('Failed to save document:', error);
    return NextResponse.json(
      { ok: false, error: error?.message || 'failed' },
      { status: 500 }
    );
  }
}
