"use client";

import { useState } from "react";
import type { DebugDataStructure } from "@/lib/s3-debug";

interface DebugDataViewerProps {
  data: DebugDataStructure;
  metadata?: any;
}

export default function DebugDataViewer({
  data,
  metadata,
}: DebugDataViewerProps) {
  const [activeTab, setActiveTab] = useState<
    "summary" | "timeline" | "drive" | "gmail" | "llm" | "raw"
  >("summary");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["timeline"]),
  );

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Summary</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-muted-foreground">Total Duration</div>
            <div className="text-lg font-medium">
              {data.summary.totalDuration}ms
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">API Calls</div>
            <div className="text-lg font-medium">{data.summary.apiCalls}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Drive Results</div>
            <div className="text-lg font-medium">
              {data.searchResults.drive.totalFound}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Gmail Results</div>
            <div className="text-lg font-medium">
              {data.searchResults.gmail.totalFound}
            </div>
          </div>
        </div>
        {data.summary.error && (
          <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
            <div className="text-sm font-medium text-destructive">Error</div>
            <div className="text-sm text-destructive/80">
              {data.summary.error}
            </div>
          </div>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-border">
        <nav className="flex space-x-8">
          {[
            { id: "summary", label: "Overview" },
            { id: "timeline", label: "Timeline" },
            { id: "drive", label: "Drive Search" },
            { id: "gmail", label: "Gmail Search" },
            { id: "llm", label: "LLM Context" },
            { id: "raw", label: "Raw Data" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-2 px-1 border-b-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="rounded-lg border border-border bg-card p-6">
        {activeTab === "summary" && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Overview</h3>
            <div className="space-y-2">
              <div className="flex justify-between py-2 border-b">
                <span className="text-sm text-muted-foreground">Status</span>
                <span
                  className={`text-sm font-medium ${data.summary.success ? "text-green-600" : "text-red-600"}`}
                >
                  {data.summary.success ? "✅ Success" : "❌ Failed"}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-sm text-muted-foreground">Timestamp</span>
                <span className="text-sm">
                  {new Date(data.summary.timestamp).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-sm text-muted-foreground">
                  Timeline Events
                </span>
                <span className="text-sm">{data.timeline.length}</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-sm text-muted-foreground">
                  Total Queries
                </span>
                <span className="text-sm">
                  {data.searchResults.drive.queries.length +
                    data.searchResults.gmail.queries.length}
                </span>
              </div>
            </div>
          </div>
        )}

        {activeTab === "timeline" && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Execution Timeline</h3>
            <div className="space-y-2">
              {data.timeline.map((event, idx) => (
                <div
                  key={idx}
                  className={`flex items-start gap-4 py-2 ${
                    event.action === "ERROR"
                      ? "bg-destructive/10 px-3 rounded"
                      : ""
                  }`}
                >
                  <div className="text-xs text-muted-foreground w-20 shrink-0">
                    {event.timestamp}ms
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{event.action}</div>
                    {event.details && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {event.details}
                      </div>
                    )}
                    {event.query && (
                      <div className="text-xs bg-background border border-border px-2 py-1 rounded mt-1 font-mono">
                        {event.query}
                      </div>
                    )}
                    {event.resultCount !== undefined && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Results: {event.resultCount} • Duration:{" "}
                        {event.duration}ms
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "drive" && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Google Drive Search</h3>

            <div>
              <h4 className="text-sm font-medium mb-2">
                Queries ({data.searchResults.drive.queries.length})
              </h4>
              <div className="space-y-2">
                {data.searchResults.drive.queries.map((query, idx) => (
                  <div
                    key={idx}
                    className="text-sm bg-background border border-border px-3 py-2 rounded font-mono"
                  >
                    {query}
                  </div>
                ))}
              </div>
            </div>

            {data.searchResults.drive.results.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">
                  Results ({data.searchResults.drive.totalFound} found,{" "}
                  {data.searchResults.drive.included} included)
                </h4>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {data.searchResults.drive.results.map((result: any, idx) => (
                    <div key={idx} className="border rounded p-3">
                      <div className="font-medium text-sm">
                        {result.name || result.title}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Type: {result.mimeType || "unknown"}
                      </div>
                      {result.content && (
                        <div className="text-xs text-muted-foreground mt-1">
                          <div className="font-medium">Content:</div>
                          <div className="max-h-20 overflow-y-auto bg-background border border-border p-2 rounded mt-1">
                            {result.content.slice(0, 300)}
                            {result.content.length > 300 && "..."}
                          </div>
                        </div>
                      )}
                      {result.snippet && !result.content && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {result.snippet}
                        </div>
                      )}
                      {(result.url || result.webViewLink) && (
                        <a
                          href={result.url || result.webViewLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline mt-1 inline-block"
                        >
                          View in Drive →
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.searchResults.drive.errors &&
              data.searchResults.drive.errors.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2 text-destructive">
                    Errors
                  </h4>
                  {data.searchResults.drive.errors.map((error, idx) => (
                    <div
                      key={idx}
                      className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded"
                    >
                      {error}
                    </div>
                  ))}
                </div>
              )}
          </div>
        )}

        {activeTab === "gmail" && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Gmail Search</h3>

            <div>
              <h4 className="text-sm font-medium mb-2">
                Queries ({data.searchResults.gmail.queries.length})
              </h4>
              <div className="space-y-2">
                {data.searchResults.gmail.queries.map((query, idx) => (
                  <div
                    key={idx}
                    className="text-sm bg-background border border-border px-3 py-2 rounded font-mono break-all"
                  >
                    {query}
                  </div>
                ))}
              </div>
            </div>

            {data.searchResults.gmail.results.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">
                  Results ({data.searchResults.gmail.totalFound} found,{" "}
                  {data.searchResults.gmail.included} included)
                </h4>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {data.searchResults.gmail.results.map((result: any, idx) => (
                    <div key={idx} className="border rounded p-3">
                      <div className="flex items-start justify-between">
                        <div className="font-medium text-sm">
                          {result.subject || "No Subject"}
                        </div>
                        {result.isThreadRepresentative &&
                          result.threadMessageCount > 1 && (
                            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                              Thread ({result.threadMessageCount} messages)
                            </span>
                          )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        From: {result.from || "Unknown"} • To:{" "}
                        {result.to || "Unknown"}
                      </div>
                      {result.body && (
                        <div className="text-xs text-muted-foreground mt-1">
                          <div className="font-medium">Body:</div>
                          <div className="max-h-20 overflow-y-auto bg-background border border-border p-2 rounded mt-1">
                            {result.body}
                          </div>
                        </div>
                      )}
                      {result.snippet && !result.body && (
                        <div className="text-xs text-muted-foreground mt-1">
                          <div className="font-medium">Snippet:</div>
                          <div>{result.snippet}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "llm" && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">LLM Context</h3>

            <div className="space-y-2">
              <div className="flex justify-between py-2 border-b">
                <span className="text-sm text-muted-foreground">Model</span>
                <span className="text-sm font-mono">
                  {data.llmContext.model}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-sm text-muted-foreground">
                  Temperature
                </span>
                <span className="text-sm">{data.llmContext.temperature}</span>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium mb-2">System Prompt</h4>
              <pre className="text-xs bg-background border border-border p-3 rounded overflow-x-auto max-h-40">
                {data.llmContext.systemPrompt}
              </pre>
            </div>

            <div>
              <h4 className="text-sm font-medium mb-2">User Prompt</h4>
              <pre className="text-xs bg-background border border-border p-3 rounded overflow-x-auto max-h-40">
                {data.llmContext.userPrompt}
              </pre>
            </div>

            <div>
              <h4 className="text-sm font-medium mb-2">LLM Response</h4>
              <pre className="text-xs bg-background border border-border p-3 rounded overflow-x-auto max-h-40">
                {data.llmContext.response}
              </pre>
            </div>
          </div>
        )}

        {activeTab === "raw" && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Raw Data</h3>
            <div className="text-xs text-muted-foreground mb-2">
              Complete debug data structure (JSON)
            </div>
            <pre className="text-xs bg-background border border-border p-4 rounded overflow-x-auto max-h-96">
              {JSON.stringify(data, null, 2)}
            </pre>
            <button
              onClick={() => {
                const blob = new Blob([JSON.stringify(data, null, 2)], {
                  type: "application/json",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `debug-${data.summary.briefId}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90"
            >
              Download JSON
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
