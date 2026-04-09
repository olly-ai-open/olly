import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import UserStoriesWizard from "@/components/user-stories/user-stories-wizard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Olly - User Stories Generator",
  description: "Generate user stories from your documents and inputs",
};

export default async function UserStoriesPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/");
  }

  return (
    <main className="container mx-auto max-w-4xl px-4 py-8">
      <UserStoriesWizard />
    </main>
  );
}
