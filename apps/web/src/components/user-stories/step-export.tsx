"use client";

import { useState } from "react";
import { WizardData } from "./user-stories-wizard";

interface Props {
  data: WizardData;
  onBack: () => void;
}

export default function StepExport({ data, onBack }: Props) {
  const [projectKey, setProjectKey] = useState("");
  const [isPushing, setIsPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Array<{ key: string; url: string; title: string }>>([]);
  const [activeExport, setActiveExport] = useState<"jira" | "notion" | "download" | null>(null);

  const selectedStories = data.generatedStories.filter((s) => s.selected);

  const handlePushToJira = async () => {
    if (!projectKey) {
      setError("Please enter a Jira project key");
      return;
    }
    setIsPushing(true);
    setError(null);
    const created = [];
    for (const story of selectedStories) {
      try {
        const resp = await fetch("/api/jira/create-issue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            summary: story.title,
            description: story.description,
            projectKey,
            issueType: "Task",
          }),
        });
        const result = await resp.json();
        if (resp.ok) {
          created.push({ key: result.issueKey, url: result.url, title: story.title });
        }
      } catch (err) {
        console.error("Failed:", err);
      }
    }
    setResults(created);
    setIsPushing(false);
  };

  const handleDownloadCSV = () => {
    const headers = ["Title", "Description", "Priority"];
    const rows = selectedStories.map((s) => [
      `"${s.title}"`,
      `"${s.description}"`,
      s.priority,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "user-stories.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadMarkdown = () => {
    const md = selectedStories
      .map(
        (s) =>
          `## ${s.title}
**Priority:** ${s.priority}

${s.description}
`
      )
      .join("
---

");
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "user-stories.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Export User Stories</h2>
        <p className="text-sm text-muted-foreground">
          Export {selectedStories.length} selected stories to your preferred tool
        </p>
      </div>

      {/* Selected stories summary */}
      <div className="rounded-lg border border-border bg-muted/50 p-4">
        <p className="text-sm font-medium mb-3">Selected stories:</p>
        <ul className="space-y-2">
          {selectedStories.map((story) => (
            <li key={story.id} className="flex items-center gap-2 text-sm">
              <span className="rounded-full px-2 py-0.5 text-xs border bg-blue-100 text-blue-700">
                {story.priority}
              </span>
              <span>{story.title}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Export options */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <button
          type="button"
          onClick={() => setActiveExport("jira")}
          className={`rounded-lg border p-4 text-left transition-colors ${
            activeExport === "jira"
              ? "border-primary bg-primary/10"
              : "border-border hover:bg-muted"
          }`}
        >
          <div className="text-2xl mb-1">🔵</div>
          <div className="text-sm font-medium">Jira</div>
          <div className="text-xs text-muted-foreground">Push as tickets</div>
        </button>

        <button
          type="button"
          onClick={() => setActiveExport("notion")}
          className={`rounded-lg border p-4 text-left transition-colors ${
            activeExport === "notion"
              ? "border-primary bg-primary/10"
              : "border-border hover:bg-muted"
          }`}
        >
          <div className="text-2xl mb-1">📝</div>
          <div className="text-sm font-medium">Notion</div>
          <div className="text-xs text-muted-foreground">Save to Notion</div>
        </button>

        <button
          type="button"
          onClick={handleDownloadCSV}
          className="rounded-lg border border-border p-4 text-left hover:bg-muted transition-colors"
        >
          <div className="text-2xl mb-1">📊</div>
          <div className="text-sm font-medium">CSV</div>
          <div className="text-xs text-muted-foreground">Download as CSV</div>
        </button>

        <button
          type="button"
          onClick={handleDownloadMarkdown}
          className="rounded-lg border border-border p-4 text-left hover:bg-muted transition-colors"
        >
          <div className="text-2xl mb-1">📄</div>
          <div className="text-sm font-medium">Markdown</div>
          <div className="text-xs text-muted-foreground">Download as .md</div>
        </button>
      </div>

      {/* Jira export form */}
      {activeExport === "jira" && results.length === 0 && (
        <div className="rounded-lg border border-border p-6 space-y-4">
          <h3 className="font-medium">Push to Jira</h3>
          <div className="space-y-1">
            <label className="text-sm font-medium">Jira Project Key</label>
            <p className="text-xs text-muted-foreground">
              Enter your Jira project key. Examples: SEC, AUTH, FEAT, KAN
            </p>
            <input
              type="text"
              placeholder="e.g. SEC, AUTH, FEAT"
              value={projectKey}
              onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
              className="w-full rounded-md border border-border px-4 py-2 text-sm"
            />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            type="button"
            onClick={handlePushToJira}
            disabled={isPushing}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPushing ? "Creating..." : "Push to Jira"}
          </button>
        </div>
      )}

      {/* Notion export - coming soon */}
      {activeExport === "notion" && (
        <div className="rounded-lg border border-border p-6">
          <h3 className="font-medium mb-2">Export to Notion</h3>
          <p className="text-sm text-muted-foreground">
            Coming soon! You can use the Markdown download and paste into Notion for now.
          </p>
          <button
            type="button"
            onClick={handleDownloadMarkdown}
            className="mt-3 rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
          >
            Download Markdown instead
          </button>
        </div>
      )}

      {/* Jira success */}
      {results.length > 0 && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-6">
          <h3 className="font-medium text-green-700 mb-3">
            Created {results.length} Jira issues!
          </h3>
          <div className="space-y-2">
            {results.map((r) => (
              <div key={r.key} className="flex items-center gap-2">
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {r.key}
                </a>
                <span className="text-muted-foreground">{r.title}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-green-500/30 flex gap-3">
            <a
              href={results[0]?.url?.split("/browse/")[0] + `/jira/software/projects/${projectKey}/list`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              View in Jira
            </a>
            <a
              href="/generate/user-stories"
              className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              Generate more stories
            </a>
          </div>
        </div>
      )}

      {results.length === 0 && (
        <div className="flex justify-between pt-4 border-t border-border">
          <button
            type="button"
            onClick={onBack}
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
          >
            Back
          </button>
        </div>
      )}
    </div>
  );
}
