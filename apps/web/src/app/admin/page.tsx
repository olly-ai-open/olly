import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Sidebar from "@/components/sidebar";
import AdminSettingsForm from "@/components/admin-settings-form";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isAdmin: true },
  });

  if (!user?.isAdmin) {
    redirect("/");
  }

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="flex gap-6">
        <Sidebar />
        <div className="flex-1">
          <h1 className="mb-6 text-2xl font-semibold">Admin Settings</h1>
          <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <AdminSettingsForm />
          </div>
        </div>
      </div>
    </main>
  );
}
