"use client";

import { useState, useEffect } from "react";
import ConversationStarters from "./conversation-starters";

interface Template {
  id: string;
  name: string;
  docType: string;
  templateSource: string;
}

interface GenerateDocumentFormProps {
  onSubmit: (prompt: string, templateId?: string) => void;
}

export default function GenerateDocumentForm({
  onSubmit,
}: GenerateDocumentFormProps) {
  const [prompt, setPrompt] = useState("");
  const [templateId, setTemplateId] = useState<string | undefined>();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

  useEffect(() => {
    const loadTemplates = async () => {
      try {
        const res = await fetch("/api/docgen/templates");
        const data = await res.json();
        if (data.ok) {
          setTemplates(data.templates);
        }
      } catch (err) {
        console.error("Failed to load templates:", err);
      }
    };
    loadTemplates();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isLoading) return;
    setIsLoading(true);
    onSubmit(prompt.trim(), templateId);
  };

  const handleStarterClick = (starterText: string) => {
    setPrompt(starterText);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* Conversation starters - shown first always */}
      <ConversationStarters onSelect={handleStarterClick} />

      {/* Main input */}
      <div>
        <label htmlFor="prompt" className="mb-2 block text-sm font-medium">
          What do you want to generate?
        </label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what you need..."
          rows={4}
          className="w-full resize-none rounded-lg border border-border bg-background px-4 py-3 text-base placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          autoFocus
        />
      </div>

      {/* Template selector */}
      <div className="rounded-lg border border-border p-4">
        <button
          type="button"
          onClick={() => setShowTemplates(!showTemplates)}
          className="flex w-full items-center justify-between text-sm font-medium"
        >
          <span>
            {templateId
              ? `Using template: ${templates.find((t) => t.id === templateId)?.name}`
              : "Use a template (optional)"}
          </span>
          <span className="text-muted-foreground">
            {showTemplates ? "-" : "+"}
          </span>
        </button>

        {showTemplates && (
          <div className="mt-4 space-y-2">
            <button
              type="button"
              onClick={() => setTemplateId(undefined)}
              className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                !templateId
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-border/30"
              }`}
            >
              No template (use defaults)
            </button>
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => setTemplateId(template.id)}
                className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                  templateId === template.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-border/30"
                }`}
              >
                <span className="font-medium">{template.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  ({template.docType.replace("_", " ")})
                </span>
                {template.templateSource === "system" && (
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">
                    Default
                  </span>
                )}
              </button>
            ))}
            {templates.length === 0 && (
              <p className="py-2 text-sm text-muted-foreground">
                No templates available.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Submit button */}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!prompt.trim() || isLoading}
          className="inline-flex items-center rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? (
            <>
              <svg className="mr-2 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                ircle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Starting...
            </>
          ) : (
            "Generate Document"
          )}
        </button>
      </div>
    </form>
  );
}
