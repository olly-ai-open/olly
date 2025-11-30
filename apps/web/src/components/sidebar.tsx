import { auth } from "@/lib/auth";
import { unstable_noStore as noStore } from "next/cache";
import { prisma } from "@/lib/prisma";
import NavLinkActive from "@/components/nav-link-active";

export default async function Sidebar() {
  noStore();
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  let isAdmin = false;
  let connected: { gmail: boolean; calendar: boolean; drive: boolean } = {
    gmail: false,
    calendar: false,
    drive: false,
  };
  if (userId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { isAdmin: true },
      });
      isAdmin = !!user?.isAdmin;
      const account = await prisma.account.findFirst({
        where: { userId, provider: "google" },
      });
      const scope = account?.scope || "";
      connected = {
        gmail: scope.includes("gmail"),
        calendar: scope.includes("calendar"),
        drive: scope.includes("drive"),
      };
    } catch {
      // DB unavailable — keep sidebar rendering with defaults
      connected = { gmail: false, calendar: false, drive: false };
    }
  }

  const itemCls =
    "flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-border/40";
  const dot = (ok: boolean) => (
    <span
      className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-green-500" : "bg-zinc-300"}`}
    />
  );

  return (
    <aside className="hidden w-60 shrink-0 md:block">
      <div className="sticky top-6 space-y-4">
        <nav className="rounded-lg border border-border bg-card p-2 shadow-sm">
          <NavLinkActive href="/" className={itemCls}>
            <span>Dashboard</span>
          </NavLinkActive>
          <NavLinkActive className={itemCls} href="/people">
            <span>People</span>
          </NavLinkActive>
          <NavLinkActive className={itemCls} href="/action-items">
            <span>Action Items</span>
          </NavLinkActive>
          <NavLinkActive href="/integrations" className={itemCls}>
            <span>Integrations</span>
          </NavLinkActive>
          <NavLinkActive href="/settings" className={itemCls}>
            <span>Settings</span>
          </NavLinkActive>
          {isAdmin && (
            <NavLinkActive href="/admin" className={itemCls}>
              <span>Admin</span>
            </NavLinkActive>
          )}
        </nav>

        <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            Connected:
          </div>
          <div className="space-y-1 text-sm">
            <div className="flex items-center gap-2">
              {dot(connected.gmail)} Gmail
            </div>
            <div className="flex items-center gap-2">
              {dot(connected.calendar)} Calendar
            </div>
            <div className="flex items-center gap-2">
              {dot(connected.drive)} Google Drive
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
