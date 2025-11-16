import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Sidebar from "@/components/sidebar";
import SettingsForm from "@/components/settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/");
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isAdmin: true },
  });
  const isAdmin = user?.isAdmin ?? false;

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="flex gap-6">
        <Sidebar />
        <div className="flex-1">
          <h1 className="mb-6 text-2xl font-semibold">Settings</h1>
          <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <SettingsForm isAdmin={isAdmin} />
          </div>
        </div>
      </div>
    </main>
  );
}
