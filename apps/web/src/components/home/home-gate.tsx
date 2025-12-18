import { auth } from "@/lib/auth";
import Sidebar from "@/components/layout/sidebar";
import HomeDashboard from "@/components/home/home-dashboard";
import LoginHero from "@/components/home/login-hero";
import ollyMascot from "@/assets/olly-mascot.png";
import Image from "next/image";

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
        <div className="mb-3 flex items-center gap-3 rounded-2xl p-4 -mt-4">
          <h1 className="text-3xl font-semibold text-foreground">{`Hey ${firstName}!`}</h1>
          <Image src={ollyMascot} alt="Olly" className="h-8 w-8" />
        </div>
        <HomeDashboard day={day} />
      </div>
    </div>
  );
}
