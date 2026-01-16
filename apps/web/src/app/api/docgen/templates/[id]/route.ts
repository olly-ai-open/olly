import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { deleteTemplateCore } from '@olly/core';

/**
 * DELETE /api/docgen/templates/[id] - Delete a user template
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    await deleteTemplateCore(prisma, id, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('Failed to delete template:', error);
    return NextResponse.json(
      { ok: false, error: error?.message || 'failed' },
      { status: 500 }
    );
  }
}
