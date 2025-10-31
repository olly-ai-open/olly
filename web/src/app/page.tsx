import { Suspense } from "react";
export const dynamic = "force-dynamic";
export const revalidate = 0;
import HomeGate from "@/components/home-gate";

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
            <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="h-40 rounded-lg border border-border bg-card/60" />
              <div className="h-40 rounded-lg border border-border bg-card/60" />
            </div>
          }
        >
          <HomeGate day={dateParam} />
        </Suspense>
      </main>
    </div>
  );
}
