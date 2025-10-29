import Link from "next/link";
import { auth } from "@/lib/auth";
import { unstable_noStore as noStore } from "next/cache";

export default async function NavAuth() {
  noStore();
  const session = await auth();
  const user = session?.user as (typeof session.user & { id: string }) | undefined;
  return (
    <div className="flex items-center justify-end gap-3 text-sm">
      {user && (
        <>
          <span className="hidden sm:inline text-muted-foreground">{user.email}</span>
          <Link className="underline" href="/api/auth/signout?callbackUrl=/">Sign out</Link>
        </>
      )}
    </div>
  );
}
