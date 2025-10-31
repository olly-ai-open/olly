import { auth } from "@/lib/auth";
import { getAccessTokenFromAccount } from "@/lib/google";
import { prisma } from "@/lib/prisma";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import Sidebar from "@/components/sidebar";
import LoginHero from "@/components/login-hero";

const providerSignInUrl = "/api/auth/signin/google?callbackUrl=/integrations";

export default async function IntegrationsPage() {
  noStore();
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <main className="container mx-auto px-4 py-8">
        <LoginHero />
      </main>
    );
  }

  let account: any = null;
  try {
    account = await prisma.account.findFirst({
      where: { userId: session.user.id, provider: "google" },
    });
  } catch {
    account = null;
  }
  let health: { connected: boolean; reason?: string } = {
    connected: false,
    reason: "no_account",
  };
  if (account) {
    try {
      const token = await getAccessTokenFromAccount(account);
      const resp = await fetch(
        "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1",
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );
      if (resp.ok) health = { connected: true };
      else
        health = {
          connected: false,
          reason: `calendar_health_failed: ${resp.status}`,
        };
    } catch (e: any) {
      health = { connected: false, reason: e?.message || "unknown_error" };
    }
  }

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="flex gap-6">
        <Sidebar />
        <div className="flex-1">
          <h1 className="mb-4 text-2xl font-semibold">Integrations</h1>
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Google Workspace</div>
                <div className="text-sm text-muted-foreground">
                  Calendar, Drive, and Gmail access for brief generation.
                </div>
              </div>
              <div className="text-sm">
                {health.connected ? (
                  <span className="text-green-600">Connected</span>
                ) : (
                  <span className="text-red-600">Not Connected</span>
                )}
              </div>
            </div>
            {!health.connected && (
              <div className="mt-3 text-sm text-muted-foreground">
                Reason: {"reason" in health ? health.reason : "unknown"}
              </div>
            )}
            <div className="mt-4 flex items-center gap-4">
              {health.connected ? (
                <Link
                  className="underline"
                  href="/api/auth/signout?callbackUrl=/integrations"
                >
                  Disconnect
                </Link>
              ) : (
                <Link className="underline" href={providerSignInUrl}>
                  Connect Google
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
