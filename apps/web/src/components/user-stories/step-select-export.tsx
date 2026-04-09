"use client";

import { useState, useEffect } from "react";
import { WizardData } from "./user-stories-wizard";

interface ExistingIssue {
  key: string;
  summary: string;
  status: string;
  created: string;
  creator: string;
  url: string;
}

interface IntegrationStatus {
  notion: boolean;
  airtable: boolean;
  jira: boolean;
  slack: boolean;
  gmail: boolean;
  google_drive: boolean;
  google_docs: boolean;
}

interface Props {
  data: WizardData;
  onUpdate: (updates: Partial<WizardData>) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function StepSelectExport({ data, onUpdate, onNext, onBack }: Props) {
  const [isChecking, setIsChecking] = useState(false);
  const [existingIssues, setExistingIssues] = useState<ExistingIssue[]>([]);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [projectKey, setProjectKey] = useState("");
  const [dateRangeDays, setDateRangeDays] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null);

  useEffect(() => {
    fetch("/api/integrations/status")
      .then((r) => r.json())
      .then((d) => setIntegrations(d))
      .catch(() => setIntegrations(null));
  }, []);

  const EXPORT_OPTIONS = [
    {
      id: "jira",
      label: "Jira",
      icon: "🔵",
      description: "Push as tickets",
      connected: integrations?.jira ?? null,
    },
    {
      id: "notion",
      label: "Notion",
      icon: "📝",
      description: "Save to Notion",
      connected: integrations?.notion ?? null,
      note: "Notion used as input may cause circular reference",
    },
    {
      id: "csv",
      label: "CSV",
      icon: "📊",
      description: "Download as CSV",
      connected: true,
    },
    {
      id: "markdown",
      label: "Markdown",
      icon: "📄",
      description: "Download as .md",
      connected: true,
    },
  ];

  const handleSelectDestination = (dest: string, connected: boolean | null) => {
    if (connected === false) return;
    onUpdate({ exportDestination: dest as any });
    if (dest !== "jira") {
      setShowDuplicates(false);
      setExistingIssues([]);
    }
  };

  const checkDuplicates = async () => {
    if (!projectKey) {
      setError("Please enter a project key to check for duplicates");
      return;
    }
    setIsChecking(true);
    setError(null);
    try {
      const resp = await fetch("/api/jira/search-issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: data.description,
          projectKey,
          dateRangeDays,
        }),
      });
      const result = await resp.json();
      setExistingIssues(result.issues || []);
      setShowDuplicates(true);
   } catch {
      setExistingIssues([]);
      setShowDuplicates(true);
    } finally {
      setIsChecking(false);
    }
  };

  const handleNext = () => {
    if (!data.exportDestination) {
      setError("Please select an export destination");
      return;
    }
    setError(null);
    onNext();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Select Export Destination</h2>
        <p className="text-sm text-muted-foreground">
          Choose where to export your{" "}
          {data.generatedStories.filter((s) => s.selected).length} selected stories
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {EXPORT_OPTIONS.map((option) => (
          <div key={option.id} className="space-y-1">
            <button
              type="button"
              onClick={() => handleSelectDestination(option.id, option.connected)}
              disabled={option.connected === false}
              className={`w-full rounded-lg border p-4 text-left transition-colors ${
                data.exportDestination === option.id
                  ? "border-primary bg-primary/10"
                  : option.connected === false
                  ? "border-border opacity-40 cursor-not-allowed bg-muted/30"
                  : "border-border hover:bg-muted"
              }`}
            >
              <div className="text-2xl mb-1">{option.icon}</div>
              <div className="text-sm font-medium">{option.label}</div>
              <div className="text-xs text-muted-foreground">{option.description}</div>
              {option.connected === false && (
                <div className="text-xs text-red-500 mt-1">Not connected</div>
              )}
            </button>
            {option.note && option.connected !== false && (
              <p className="text-xs text-amber-600">{option.note}</p>
            )}
          </div>
        ))}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {data.exportDestination === "jira" && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold">Check for duplicate Jira tickets</p>
            <p className="text-xs text-muted-foreground mt-1">
              Search your Jira project for similar issues before pushing
            </p>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Project key (e.g. KAN)"
              value={projectKey}
              onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
              className="flex-1 rounded-md border border-border px-3 py-2 text-sm"
            />
            <select
              value={dateRangeDays}
              onChange={(e) => setDateRangeDays(Number(e.target.value))}
              className="rounded-md border border-border px-3 py-2 text-sm bg-background"
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={180}>Last 6 months</option>
              <option value={365}>Last 1 year</option>
            </select>
            <button
              type="button"
              onClick={checkDuplicates}
              disabled={isChecking}
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
            >
              {isChecking ? "Searching..." : "Check Duplicates"}
            </button>
          </div>

          {showDuplicates && (
            <div>
              {existingIssues.length === 0 ? (
                <div className="rounded-md bg-green-500/10 border border-green-500/30 p-3">
                  <p className="text-sm text-green-700">
                    No similar tickets found. Safe to create new stories!
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-amber-600">
                    Found {existingIssues.length} similar existing ticket(s):
                  </p>
                  {existingIssues.map((issue) => (
                    <div
                      key={issue.key}
                      className="rounded-md border border-amber-200 bg-amber-50/50 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <a
                            href={issue.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm font-medium text-primary underline"
                          >
                            {issue.key}
                          </a>
                          <span className="ml-2 text-sm">{issue.summary}</span>
                          <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                            <span>Status: {issue.status}</span>
                            <span>
                              {new Date(issue.created).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 border border-amber-200 whitespace-nowrap">
                          Possible duplicate
                        </span>
                      </div>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => window.open(issue.url, "_blank")}
                          className="rounded-md bg-green-600 px-3 py-1 text-xs text-white hover:bg-green-700"
                        >
                          Keep existing
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-border px-3 py-1 text-xs hover:bg-muted"
                        >
                          Keep both
                        </button>
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Review these before proceeding. You can still create new stories.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between pt-4 border-t border-border">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleNext}
          disabled={!data.exportDestination}
          className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}