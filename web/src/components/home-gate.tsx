import { auth } from "@/lib/auth";
import Sidebar from "@/components/sidebar";
import HomeDashboard from "@/components/home-dashboard";
import LoginHero from "@/components/login-hero";
import { unstable_noStore as noStore } from "next/cache";

export default async function HomeGate({ day }: { day?: string }) {
  noStore();
  const session = await auth();
  const firstName = session?.user?.name?.split(" ")?.[0];
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) {
    return <LoginHero />;
  }
  return (
    <div className="flex gap-6">
      <Sidebar />
      <div className="flex-1">
        <h1 className="mb-2 text-3xl font-semibold">{`Good Morning ${firstName}!`}</h1>
        <p className="text-foreground">Here’s what’s on deck today.</p>
        <HomeDashboard day={day} />
      </div>
    </div>
  );
}
