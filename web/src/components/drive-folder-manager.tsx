import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { getAccessTokenFromAccount } from "@/lib/google";
import GoogleDrivePicker from "./google-drive-picker";
import RemoveFolderButton from "./remove-folder-button";
import DriveAccessSelector from "./drive-access-selector";

interface DriveFolderManagerProps {
  userId: string;
}

async function getUserDriveFolders(userId: string) {
  return await prisma.driveFolder.findMany({
    where: { userId },
    orderBy: { folderName: "asc" },
  });
}

async function getUserGoogleAccount(userId: string) {
  return await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });
}

async function getUserGoogleIntegration(userId: string) {
  return await prisma.integration.findFirst({
    where: { userId, provider: "google_workspace" },
    select: { meta: true },
  });
}

export default async function DriveFolderManager({
  userId,
}: DriveFolderManagerProps) {
  // Get user's Google account for access token
  const account = await getUserGoogleAccount(userId);

  // Get user's selected Drive folders
  const folders = await getUserDriveFolders(userId);

  // Get user's drive access preference
  const integration = await getUserGoogleIntegration(userId);
  const driveAccess = (integration?.meta as any)?.driveAccess || "folders";

  let accessToken: string | null = null;
  let needsReauth = false;

  try {
    if (account) {
      accessToken = await getAccessTokenFromAccount(account);
    }
  } catch (error: any) {
    console.error("Failed to get access token:", error);
    if (error?.message === "REAUTH_REQUIRED") {
      needsReauth = true;
    }
  }

  return (
    <div className="space-y-6">
      {needsReauth ? (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <h3 className="font-medium text-sm mb-2 text-yellow-900">
            Re-authentication Required
          </h3>
          <p className="text-xs text-yellow-800 mb-3">
            Your Google authentication has expired.
          </p>
          <Link
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            href="/api/auth/google-connect"
          >
            Reconnect Google Account
          </Link>
        </div>
      ) : (
        <>
          <div>
            <h3 className="font-medium text-sm mb-3">
              Drive Access Configuration
            </h3>
            <DriveAccessSelector
              currentAccess={driveAccess as "full" | "folders"}
            />
          </div>

          {driveAccess === "folders" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium text-sm">Selected Folders</h4>
                  <p className="text-xs text-muted-foreground">
                    Choose specific folders to search for meeting context
                  </p>
                </div>
                {accessToken && <GoogleDrivePicker accessToken={accessToken} />}
              </div>

              {folders.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">
                    Accessible Folders ({folders.length})
                  </div>
                  <div className="space-y-1">
                    {folders.map((folder) => (
                      <div
                        key={folder.id}
                        className="flex items-center justify-between rounded-md border border-border bg-card/50 px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-blue-600">📁</span>
                          <span className="text-sm">{folder.folderName}</span>
                          {folder.path && folder.path !== folder.folderName && (
                            <span className="text-xs text-muted-foreground">
                              ({folder.path})
                            </span>
                          )}
                        </div>
                        <RemoveFolderButton folderId={folder.folderId} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-border p-4 text-center">
                  <div className="text-sm text-muted-foreground">
                    No folders selected yet
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Use the &quot;Select Drive Folders&quot; button to give
                    access to specific folders
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
