import { Suspense } from "react";
import type { Metadata } from "next";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import HomeGate from "@/components/home-gate";

export const metadata: Metadata = {
  title: "Olly - Dashboard",
  description: "Dashboard",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const dateParam = (Array.isArray(sp?.date) ? sp?.date[0] : sp?.date) as
    | string
    | undefined;
  return (
    <div className="min-h-dvh bg-background">
      <main className="container mx-auto px-4 py-8">
        <Suspense
          fallback={
            <div className="mt-8 flex items-center justify-center">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span
                  className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-border border-t-transparent"
                  aria-hidden="true"
                />
                <span>Loading your day...</span>
              </div>
            </div>
          }
        >
          <HomeGate day={dateParam} />
        </Suspense>
      </main>
    </div>
  );
}
