import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * First-run gate for the desktop app only.
 *
 * The Electron shell sets OLLY_DESKTOP=1 on the bundled server. When no LLM
 * key is configured yet, every page is redirected to /setup so the user can
 * enter one. A self-hosted server configures keys through its environment and
 * must never be redirected here, otherwise a missing key would also hijack
 * the cron routes.
 */
export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  const isDesktop = process.env.OLLY_DESKTOP === "1";
  const hasLlm =
    Boolean(process.env.OPENAI_API_KEY) ||
    Boolean(process.env.ANTHROPIC_API_KEY);

  const isSetupPath = path.startsWith("/setup") || path.startsWith("/api/setup");

  if (isDesktop && !hasLlm && !isSetupPath) {
    return NextResponse.redirect(new URL("/setup", req.url));
  }

  return NextResponse.next();
}

export const config = {
  // Exclude Next internals, the favicon, and static/public assets (images,
  // fonts, sw.js, etc.). Without the asset exclusion, the no-LLM-key redirect
  // intercepts requests like /olly-mascot.png and breaks them on /setup.
  matcher: [
    "/((?!_next|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|otf|js|css|map)).*)",
  ],
};