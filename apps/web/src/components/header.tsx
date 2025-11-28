import Link from "next/link";
import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { unstable_noStore as noStore } from "next/cache";
import NavAuth from "@/components/nav-auth";
import ThemeToggle from "@/components/theme-toggle";
import MobileNav from "@/components/mobile-nav";
import CommandPalette from "@/components/command-palette";

export default async function Header() {
  noStore();
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;

  let connected: { gmail: boolean; calendar: boolean; drive: boolean } = {
    gmail: false,
    calendar: false,
    drive: false,
  };

  if (userId) {
    try {
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
      // DB unavailable — keep defaults
      connected = { gmail: false, calendar: false, drive: false };
    }
  }

  return (
    <header className="border-b border-border bg-card/70 backdrop-blur">
      <div className="container mx-auto flex items-center justify-between px-4 py-3">
        <Link href="/" className="font-semibold text-lg text-primary">
          Olly
        </Link>
        <div className="flex items-center gap-3">
          {userId ? <CommandPalette /> : null}
          <ThemeToggle />
          <Suspense fallback={<div className="h-5 w-24 rounded bg-border" />}>
            <NavAuth />
          </Suspense>
          {/* Mobile Navigation - only show if user is logged in */}
          {userId && <MobileNav connected={connected} />}
        </div>
      </div>
    </header>
  );
}
