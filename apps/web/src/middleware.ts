import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  const hasLlm =
    Boolean(process.env.OPENAI_API_KEY) ||
    Boolean(process.env.ANTHROPIC_API_KEY);

  const isSetupPath = path.startsWith("/setup") || path.startsWith("/api/setup");

  if (!hasLlm && !isSetupPath) {
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