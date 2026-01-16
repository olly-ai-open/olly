import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import GenerateDocumentView from '@/components/docgen/generate-document-view';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Olly - Generate Document',
  description: 'Generate documents from your workspace',
};

export default async function GeneratePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/');
  }

  return (
    <main className="container mx-auto max-w-4xl px-4 py-8">
      <GenerateDocumentView userId={session.user.id} />
    </main>
  );
}
