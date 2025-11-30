import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Sidebar from "@/components/sidebar";
import SettingsForm from "@/components/settings-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Olly - Settings",
  description: "Settings",
};

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/");
  }

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="flex gap-6">
        <Sidebar />
        <div className="flex-1">
          <h1 className="mb-6 text-2xl font-semibold">Settings</h1>
          <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <SettingsForm />
          </div>
        </div>
      </div>
    </main>
  );
}
