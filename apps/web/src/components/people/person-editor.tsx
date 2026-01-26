"use client";

import { useState } from "react";

interface PersonEditorProps {
  personId: string;
  initialName: string | null;
  initialTitle: string | null;
  initialOrg: string | null;
}

export default function PersonEditor({
  personId,
  initialName,
  initialTitle,
  initialOrg,
}: PersonEditorProps) {
  const [name, setName] = useState(initialName ?? "");
  const [title, setTitle] = useState(initialTitle ?? "");
  const [org, setOrg] = useState(initialOrg ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/people/${personId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          title,
          org,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setMessage(
          payload?.error || "Failed to save person details. Please try again.",
        );
      } else {
        setMessage("Saved");
        setTimeout(() => setMessage(null), 2500);
      }
    } catch {
      setMessage("Failed to save person details. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label
            htmlFor="person-name"
            className="block text-sm font-medium text-foreground mb-1"
          >
            Name
          </label>
          <input
            id="person-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Name for this person"
          />
        </div>
        <div>
          <label
            htmlFor="person-title"
            className="block text-sm font-medium text-foreground mb-1"
          >
            Title
          </label>
          <input
            id="person-title"
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Job title"
          />
        </div>
      </div>
      <div>
        <label
          htmlFor="person-org"
          className="block text-sm font-medium text-foreground mb-1"
        >
          Organization
        </label>
        <input
          id="person-org"
          type="text"
          value={org}
          onChange={(event) => setOrg(event.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Company or organization"
        />
      </div>

      <div className="flex items-center justify-between pt-2">
        {message && (
          <p
            className={`text-sm ${
              message === "Saved" ? "text-green-600" : "text-destructive"
            }`}
          >
            {message}
          </p>
        )}
        <button
          type="submit"
          disabled={saving}
          className="ml-auto rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}
