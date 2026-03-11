"use client";

import { useState } from "react";
import CitationsPanel from "./citations-panel";

interface Citation {
  evidenceId: string;
  sourceType: string;
  sourceRef: string | null;
  title: string;
  snippet: string;
}

interface GeneratedDocument {
  id: string;
  title: string;
  docType: string;
  content: {
    sections: Array<{
      heading: string;
      content: string;
      citations: string[];
    }>;
    markdown: string;
  };
  citations: Citation[];
  openQuestions: string[];
  savedAt: string | null;
  createdAt: string;
}

interface DocumentViewerProps {
  document: GeneratedDocument;
  onSave: () => void;
  onNewDocument: () => void;
}

export default function DocumentViewer({
  document,
  onSave,
  onNewDocument,
}: DocumentViewerProps) {
  const [showCitations, setShowCitations] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(document.content.markdown);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  const handleExport = () => {
    const blob = new Blob([document.content.markdown], {
      type: "text/markdown",
    });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement("a");
    a.href = url;
    a.download = `${document.title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.md`;
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">{document.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {document.docType.replace("_", " ")} • Generated{" "}
            {new Date(document.createdAt).toLocaleString()}
            {document.savedAt && " • Saved"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-border/30"
          >
            {copySuccess ? "Copied!" : "Copy"}
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-border/30"
          >
            Export
          </button>
          {!document.savedAt && (
            <button
              type="button"
              onClick={onSave}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
            >
              Save
            </button>
          )}
        </div>
      </div>

      {/* Document content */}
      <div className="rounded-lg border border-border bg-card p-6">
        {/* Sections */}
        <div className="prose prose-sm max-w-none dark:prose-invert">
          {document.content.sections.map((section, idx) => (
            <div key={idx} className="mb-6 last:mb-0">
              <h3 className="mb-2 text-lg font-semibold">{section.heading}</h3>
              <div
                className="whitespace-pre-wrap"
                dangerouslySetInnerHTML={{
                  __html: formatContent(section.content),
                }}
              />
              {section.citations.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Sources: {section.citations.join(", ")}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Open Questions */}
        {document.openQuestions.length > 0 && (
          <div className="mt-8 rounded-lg border border-warning/50 bg-warning/10 p-4">
            <h4 className="mb-2 font-semibold text-warning">Open Questions</h4>
            <ul className="list-inside list-disc space-y-1 text-sm">
              {document.openQuestions.map((q, idx) => (
                <li key={idx}>{q}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Citations toggle */}
      {document.citations.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowCitations(!showCitations)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <span>{showCitations ? "▼" : "▶"}</span>
            <span>
              {showCitations ? "Hide" : "Show"} sources (
              {document.citations.length})
            </span>
          </button>
          {showCitations && (
            <div className="mt-4">
              <CitationsPanel citations={document.citations} />
            </div>
          )}
        </div>
      )}

      {/* New document button */}
      <div className="border-t border-border pt-6">
        <button
          type="button"
          onClick={onNewDocument}
          className="text-sm text-primary hover:underline"
        >
          Generate another document
        </button>
      </div>
    </div>
  );
}

function formatContent(content: string): string {
  // Basic markdown-like formatting
  return content
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/\n- /g, "<br/>• ")
    .replace(/\n\d+\. /g, (match) => `<br/>${match.trim()} `)
    .replace(/\n/g, "<br/>");
}
