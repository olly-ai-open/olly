import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { hasSchedulingScopes } from "@/lib/google";
import Sidebar from "@/components/layout/sidebar";
import SchedulingDashboard from "@/components/scheduling/scheduling-dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Olly - Scheduling",
  description: "Let Olly find meeting times for you",
};

export default async function SchedulingPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <main className="container mx-auto px-4 py-8">
        <div className="text-sm text-muted-foreground">
          Sign in to schedule meetings.
        </div>
      </main>
    );
  }

  const scopesOk = await hasSchedulingScopes(session.user.id).catch(
    () => false,
  );

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="flex gap-6">
        <Sidebar />
        <div className="flex-1 space-y-6">
          <div>
            <h1 className="text-2xl font-semibold">Scheduling</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tell Olly who to meet with and when — it emails everyone from
              your Gmail, handles the back and forth, and books the meeting.
            </p>
          </div>
          {!scopesOk ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
              Scheduling needs permission to send email and create calendar
              events on your behalf.{" "}
              <Link
                href="/api/auth/google-connect"
                className="font-medium text-primary hover:underline"
              >
                Reconnect Google
              </Link>{" "}
              to grant access.
            </div>
          ) : null}
          <SchedulingDashboard scopesOk={scopesOk} />
        </div>
      </div>
    </main>
  );
}
