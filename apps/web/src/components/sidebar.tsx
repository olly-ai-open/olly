import { auth } from "@/lib/auth";
import { unstable_noStore as noStore } from "next/cache";
import { prisma } from "@/lib/prisma";
import NavLinkActive from "@/components/nav-link-active";
import {
  Calendar,
  Users,
  CheckSquare,
  CircuitBoard,
  Settings,
  Shield,
} from "lucide-react";

export default async function Sidebar() {
  noStore();
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  let isAdmin = false;
  let connected: {
    gmail: boolean;
    calendar: boolean;
    drive: boolean;
    slack: boolean;
  } = {
    gmail: false,
    calendar: false,
    drive: false,
    slack: false,
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
      const slackAccount = await prisma.account.findFirst({
        where: { userId, provider: "slack" },
      });
      connected = {
        gmail: scope.includes("gmail"),
        calendar: scope.includes("calendar"),
        drive: scope.includes("drive"),
        slack: !!slackAccount?.access_token,
      };
    } catch {
      // DB unavailable — keep sidebar rendering with defaults
      connected = { gmail: false, calendar: false, drive: false, slack: false };
    }
  }

  const itemCls =
    "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-sidebar-accent/70 hover:text-foreground transition-colors";
  const dot = (ok: boolean) => (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? "bg-success" : "bg-muted"}`}
    />
  );

  const navItems = [
    { path: "/", label: "Dashboard", icon: Calendar },
    { path: "/people", label: "People", icon: Users },
    { path: "/action-items", label: "Action Items", icon: CheckSquare },
    { path: "/integrations", label: "Integrations", icon: CircuitBoard },
    { path: "/settings", label: "Settings", icon: Settings },
    { path: "/admin", label: "Admin", icon: Shield, adminOnly: true },
  ];

  return (
    <aside className="hidden w-60 shrink-0 md:block">
      <div className="sticky top-6 space-y-4">
        <nav className="rounded-2xl border border-border/70 bg-card/80 p-2 shadow-card">
          {navItems
            .filter((item) => !item.adminOnly || isAdmin)
            .map((item) => (
              <NavLinkActive
                key={item.path}
                href={item.path}
                className={itemCls}
              >
                <item.icon className="w-4 h-4 mr-2" />
                <span>{item.label}</span>
              </NavLinkActive>
            ))}
        </nav>

        <div className="rounded-2xl border border-border/70 bg-gradient-brand-light p-3 shadow-card">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
            <div className="flex items-center gap-2">
              {dot(connected.slack)} Slack
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
