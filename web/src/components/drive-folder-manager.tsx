import { prisma } from "@/lib/prisma";
import { getAccessTokenFromAccount } from "@/lib/google";
import GoogleDrivePicker from "./google-drive-picker";
import RemoveFolderButton from "./remove-folder-button";

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

export default async function DriveFolderManager({
  userId,
}: DriveFolderManagerProps) {
  // Get user's Google account for access token
  const account = await getUserGoogleAccount(userId);

  // Get user's selected Drive folders
  const folders = await getUserDriveFolders(userId);

  let accessToken: string | null = null;
  try {
    if (account) {
      accessToken = await getAccessTokenFromAccount(account);
    }
  } catch (error) {
    console.error("Failed to get access token:", error);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium text-sm">Drive Folder Access</h3>
          <p className="text-xs text-muted-foreground">
            Select specific folders to give the app access to
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
            Use the &quot;Select Drive Folders&quot; button to give access to
            specific folders
          </div>
        </div>
      )}
    </div>
  );
}
