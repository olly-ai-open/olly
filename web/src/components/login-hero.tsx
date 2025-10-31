import Link from "next/link";

export default function LoginHero() {
  const signInUrl = "/api/auth/signin";
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-sm">
        <div className="mb-2 text-2xl font-semibold">Welcome to Olly</div>
        <p className="mb-6 text-sm text-muted-foreground">
          Your proactive AI Chief of Staff
        </p>
        <Link
          href={signInUrl}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-border/30"
        >
          <span>Continue with Google</span>
        </Link>
      </div>
    </div>
  );
}
