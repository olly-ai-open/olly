import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import Sidebar from "@/components/layout/sidebar";
import RequestDetail from "@/components/scheduling/request-detail";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Olly - Scheduling Request",
  description: "Scheduling request status",
};

export default async function SchedulingRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <main className="container mx-auto px-4 py-8">
        <div className="text-sm text-muted-foreground">
          Sign in to view this scheduling request.
        </div>
      </main>
    );
  }
  const { id } = await params;

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="flex gap-6">
        <Sidebar />
        <div className="flex-1">
          <RequestDetail requestId={id} />
        </div>
      </div>
    </main>
  );
}
