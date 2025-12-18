import { auth } from "@/lib/auth";
import { getUserSettings } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
import { S3DebugStorage } from "@olly/core";
import DebugDataViewer from "@/components/debug/debug-data-viewer";
import BackButton from "@/components/layout/back-button";
import { notFound } from "next/navigation";

export default async function BriefDebugPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return notFound();
  }

  const settings = await getUserSettings(session.user.id);

  // Check if user is admin
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isAdmin: true },
  });

  if (!user?.isAdmin) {
    return notFound();
  }

  // Get brief with debug metadata
  const brief = await prisma.brief.findUnique({
    where: { id },
    include: {
      meeting: true,
    },
  });

  if (!brief) {
    return notFound();
  }

  // Fetch debug data from S3 if available
  let debugData = null;
  if (brief.debugS3Key) {
    const s3Storage = new S3DebugStorage();
    debugData = await s3Storage.getDebugData(id, session.user.id);
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-2">
          Debug Data: {brief.meeting?.title || "Brief"}
        </h1>
        <div className="text-sm text-muted-foreground">
          Brief ID: {id}
          {brief.debugCapturedAt && (
            <>
              {" "}
              • Captured:{" "}
              {new Date(brief.debugCapturedAt).toLocaleString("en-US", {
                timeZone: settings.timeZone || "UTC",
              })}
            </>
          )}
        </div>
      </div>

      {debugData ? (
        <DebugDataViewer
          data={debugData}
          metadata={brief.debugMetadata as any}
        />
      ) : (
        <div className="rounded-lg border border-border bg-card p-6">
          <p className="text-muted-foreground">
            No debug data available for this brief.
          </p>
        </div>
      )}

      <div className="mt-6">
        <BackButton />
      </div>
    </div>
  );
}
