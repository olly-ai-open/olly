import { checkAirtableHealth } from "@/lib/airtable";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { checkGoogleHealth } from "@/lib/google";
import { checkSlackHealth } from "@/lib/slack";
import { checkNotionHealth } from "@/lib/notion";
import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import Sidebar from "@/components/layout/sidebar";
import LoginHero from "@/components/home/login-hero";
import DriveFolderManager from "@/components/integrations/drive-folder-manager";
import Script from "next/script";
import { checkJiraHealth } from "@/lib/jira";

export const metadata: Metadata = {
  title: "Olly - Integrations",
  description: "Integrations",
};

export default async function IntegrationsPage() {
  noStore();
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <main className="container mx-auto px-4 py-8">
        <LoginHero />
      </main>
    );
  }

  const [health, slackHealth, notionHealth, airtableHealth, jiraHealth] = await Promise.all([
    checkGoogleHealth(session.user.id),
    checkSlackHealth(session.user.id),
    checkNotionHealth(session.user.id),
    checkAirtableHealth(session.user.id),
    checkJiraHealth(session.user.id),
]);


  return (
    <>
      <Script
        src="https://apis.google.com/js/api.js"
        strategy="afterInteractive"
      />

      <main className="container mx-auto px-4 py-8">
        <div className="flex gap-6">
          <Sidebar />
          <div className="flex-1">
            <h1 className="mb-4 text-2xl font-semibold">Integrations</h1>

            {/* Google Account Status Card */}
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Google Account</div>
                  <div className="text-sm text-muted-foreground">
                    Basic authentication for sign-in
                  </div>
                </div>
                <div className="text-sm">
                  {health.connected ? (
                    <span className="text-green-600">✓ Connected</span>
                  ) : (
                    <span className="text-gray-500">Not Connected</span>
                  )}
                </div>
              </div>
            </div>

            {/* Google Workspace Advanced Features Card */}
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Google Workspace</div>
                  <div className="text-sm text-muted-foreground">
                    Calendar, Drive, and Gmail access for brief generation
                  </div>
                </div>
                <div className="text-sm">
                  {health.hasAdvancedScopes ? (
                    <span className="text-green-600">✓ Connected</span>
                  ) : (
                    <span className="text-amber-600">Not Connected</span>
                  )}
                </div>
              </div>

              {!health.hasAdvancedScopes && (
                <div className="mt-3">
                  <div className="text-sm text-muted-foreground mb-3">
                    {health.connected
                      ? "Connect Google Workspace to enable meeting briefs and calendar integration"
                      : "Please sign in first to enable Google Workspace integration"}
                  </div>
                </div>
              )}

              <div className="mt-4 flex items-center gap-4">
                {health.hasAdvancedScopes ? (
                  <div className="space-y-3 w-full">
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-muted-foreground">
                        ✓ Calendar access enabled
                      </span>
                      <span className="text-sm text-muted-foreground">
                        ✓ Gmail access enabled
                      </span>
                    </div>
                    <div className="pt-3 border-t border-border">
                      <DriveFolderManager userId={session.user.id} />
                    </div>
                  </div>
                ) : health.connected ? (
                  <Link
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    href="/api/auth/google-connect"
                  >
                    Connect Google Workspace
                  </Link>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    Sign in to connect Google Workspace
                  </span>
                )}
              </div>

              {health.hasAdvancedScopes && (
                <div className="mt-4 pt-4 border-t border-border">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">
                      To fully revoke access, go to your{" "}
                      <a
                        href="https://myaccount.google.com/permissions"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        Google Account permissions
                      </a>
                    </div>
                    <form action="/api/auth/google-disconnect" method="post">
                      <button
                        type="submit"
                        className="bg-background rounded-md border border-border px-3 py-1 text-sm hover:bg-accent cursor-pointer"
                      >
                        Disconnect Workspace
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </div>

            {/* Slack Integration */}
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm mt-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Slack</div>
                  <div className="text-sm text-muted-foreground">
                    Search messages to enrich briefs
                  </div>
                </div>
                <div className="text-sm">
                  {slackHealth.connected ? (
                    <span className="text-green-600">
                      ✓ Connected
                      {slackHealth.teamName
                        ? ` to ${slackHealth.teamName}`
                        : ""}
                    </span>
                  ) : (
                    <span className="text-gray-500">Not Connected</span>
                  )}
                </div>
              </div>

              <div className="mt-4 flex items-center gap-4">
                {!slackHealth.connected && (
                  <Link
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    href="/api/auth/slack-connect"
                  >
                    Connect Slack
                  </Link>
                )}
              </div>

              {slackHealth.connected && (
                <div className="mt-4 pt-4 border-t border-border">
                  <form action="/api/auth/slack-disconnect" method="post">
                    <button
                      type="submit"
                      className="bg-background rounded-md border border-border px-3 py-1 text-sm hover:bg-accent cursor-pointer"
                    >
                      Disconnect Slack
                    </button>
                  </form>
                </div>
              )}
            </div>

            {/* Notion Integration */}
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm mt-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Notion</div>
                  <div className="text-sm text-muted-foreground">
                    Access Notion pages and databases for briefs
                  </div>
                </div>
                <div className="text-sm">
                  {notionHealth.connected ? (
                    <span className="text-green-600">✓ Connected</span>
                  ) : (
                    <span className="text-gray-500">Not Connected</span>
                  )}
                </div>
              </div>

              <div className="mt-4 flex items-center gap-4">
                {!notionHealth.connected && (
                  <Link
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    href="/api/auth/notion-connect"
                  >
                    Connect Notion
                  </Link>
                )}
              </div>

              {notionHealth.connected && (
                <div className="mt-4 pt-4 border-t border-border">
                  <form action="/api/auth/notion-disconnect" method="post">
                    <button
                      type="submit"
                      className="bg-background rounded-md border border-border px-3 py-1 text-sm hover:bg-accent cursor-pointer"
                    >
                      Disconnect Notion
                    </button>
                  </form>
                </div>
              )}
            </div>
	{/* Airtable Integration */}
<div className="rounded-lg border border-border bg-card p-4 shadow-sm mt-4">
  <div className="flex items-center justify-between">
    <div>
      <div className="font-medium">Airtable</div>
      <div className="text-sm text-muted-foreground">
        Access Airtable bases and tables for briefs
      </div>
    </div>
    <div className="text-sm">
      {airtableHealth.connected ? (
        <span className="text-green-600">Connected</span>
      ) : (
        <span className="text-gray-500">Not Connected</span>
      )}
    </div>
  </div>
  {!airtableHealth.connected && (
    <div className="mt-4">
      <div className="text-sm text-muted-foreground mb-2">
        Enter your Airtable Personal Access Token to connect
      </div>
      <form action="/api/auth/airtable-connect" method="post" className="flex gap-2">
        <input type="text" name="accessToken" placeholder="patXXXXXX..."
          className="flex-1 rounded-md border border-border px-3 py-2 text-sm" />
        <button type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Connect Airtable
        </button>
      </form>
    </div>
  )}
  {airtableHealth.connected && (
    <div className="mt-4 pt-4 border-t border-border">
      <form action="/api/auth/airtable-disconnect" method="post">
        <button type="submit"
          className="bg-background rounded-md border border-border px-3 py-1 text-sm hover:bg-accent cursor-pointer">
          Disconnect Airtable
        </button>
      </form>
    </div>
  )}
</div>

{/* JIRA Integration */}
<div className="rounded-lg border border-border bg-card p-4 shadow-sm mt-4">
  <div className="flex items-center justify-between">
    <div>
      <div className="font-medium">Jira</div>
      <div className="text-sm text-muted-foreground">
        Access Jira issues and projects for briefs
      </div>
    </div>
    <div className="text-sm">
      {jiraHealth.connected ? (
        <span className="text-green-600">Connected</span>
      ) : (
        <span className="text-gray-500">Not Connected</span>
      )}
    </div>
  </div>

  {!jiraHealth.connected && (
    <div className="mt-4">
      <div className="text-sm text-muted-foreground mb-2">
        Enter your Jira credentials to connect
      </div>
      <form action="/api/auth/jira-connect" method="post" className="space-y-2">
        <input type="text" name="baseUrl" placeholder="https://yourcompany.atlassian.net"
          className="w-full rounded-md border border-border px-3 py-2 text-sm" />
        <input type="text" name="email" placeholder="your@email.com"
          className="w-full rounded-md border border-border px-3 py-2 text-sm" />
        <input type="text" name="accessToken" placeholder="Your Jira API token"
          className="w-full rounded-md border border-border px-3 py-2 text-sm" />
        <button type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Connect Jira
        </button>
      </form>
    </div>
  )}

  {jiraHealth.connected && (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="text-sm text-muted-foreground mb-2">
        Connected to: {jiraHealth.baseUrl}
      </div>
      <form action="/api/auth/jira-disconnect" method="post">
        <button type="submit"
          className="bg-background rounded-md border border-border px-3 py-1 text-sm hover:bg-accent cursor-pointer">
          Disconnect Jira
        </button>
      </form>
    </div>
  )}
</div>

          </div>
        </div>
      </main>
    </>
  );
}
