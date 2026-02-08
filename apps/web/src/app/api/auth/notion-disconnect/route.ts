import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function POST() {
  const session = await auth();
  
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Delete Notion credentials from database
    // await deleteNotionCredentials(session.user.id);
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Failed to disconnect Notion:", error);
    return NextResponse.json(
      { error: error?.message || "notion_disconnect_error" },
      { status: 500 }
    );
  }
}
