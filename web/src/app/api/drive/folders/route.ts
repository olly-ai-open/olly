import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

interface FolderData {
  id: string;
  name: string;
  parents?: string[];
}

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { folders }: { folders: FolderData[] } = await request.json();

    if (!folders || !Array.isArray(folders)) {
      return NextResponse.json(
        { error: "Invalid folders data" },
        { status: 400 },
      );
    }

    // Save each selected folder to the database
    const savedFolders = await Promise.all(
      folders.map(async (folder) => {
        // Build folder path by traversing parents (simplified for now)
        const path = folder.name; // TODO: Build full path if needed

        return prisma.driveFolder.upsert({
          where: {
            userId_folderId: {
              userId: session.user!.id!,
              folderId: folder.id,
            },
          },
          update: {
            folderName: folder.name,
            parentId: folder.parents?.[0] || null,
            path,
            updatedAt: new Date(),
          },
          create: {
            userId: session.user!.id!,
            folderId: folder.id,
            folderName: folder.name,
            parentId: folder.parents?.[0] || null,
            path,
          },
        });
      }),
    );

    return NextResponse.json({
      success: true,
      folders: savedFolders,
      message: `Added access to ${savedFolders.length} folder(s)`,
    });
  } catch (error) {
    console.error("Error saving Drive folders:", error);
    return NextResponse.json(
      { error: "Failed to save Drive folders" },
      { status: 500 },
    );
  }
}

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const folders = await prisma.driveFolder.findMany({
      where: { userId: session.user.id },
      orderBy: { folderName: "asc" },
    });

    return NextResponse.json({ folders });
  } catch (error) {
    console.error("Error fetching Drive folders:", error);
    return NextResponse.json(
      { error: "Failed to fetch Drive folders" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { folderId } = await request.json();

    if (!folderId) {
      return NextResponse.json(
        { error: "Folder ID required" },
        { status: 400 },
      );
    }

    await prisma.driveFolder.delete({
      where: {
        userId_folderId: {
          userId: session.user.id,
          folderId,
        },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing Drive folder:", error);
    return NextResponse.json(
      { error: "Failed to remove Drive folder" },
      { status: 500 },
    );
  }
}
