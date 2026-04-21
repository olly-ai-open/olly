"use client";

import { useState } from "react";
import { WizardData, UserStory } from "./user-stories-wizard";

interface Props {
  data: WizardData;
  onUpdate: (updates: Partial<WizardData>) => void;
  onNext: () => void;
  onBack: () => void;
  onRegenerate: () => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  Critical: "bg-red-100 text-red-700 border-red-200",
  High: "bg-orange-100 text-orange-700 border-orange-200",
  Medium: "bg-blue-100 text-blue-700 border-blue-200",
  Low: "bg-gray-100 text-gray-700 border-gray-200",
};

export default function StepReviewStories({ data, onUpdate, onNext, onBack, onRegenerate }: Props) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const generateStories = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const resp = await fetch("/api/user-stories/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: data.description,
          selectedServices: data.selectedServices,
          storyCount: data.storyCount,
          includeAcceptanceCriteria: data.includeAcceptanceCriteria,
        }),
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || "Failed to generate");
      onUpdate({ generatedStories: result.stories });
    } catch (err: any) {
      setError(err.message || "Failed to generate user stories");
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleSelect = (id: string) => {
    const updated = data.generatedStories.map((s) =>
      s.id === id ? { ...s, selected: !s.selected } : s
    );
    onUpdate({ generatedStories: updated });
  };

  const selectAll = () => {
    const allSelected = data.generatedStories.every((s) => s.selected);
    onUpdate({
      generatedStories: data.generatedStories.map((s) => ({
        ...s,
        selected: !allSelected,
      })),
    });
  };

  const startEdit = (story: UserStory) => {
    setEditingId(story.id);
    setEditTitle(story.title);
    setEditDescription(story.description);
  };

  const saveEdit = (id: string) => {
    const updated = data.generatedStories.map((s) =>
      s.id === id ? { ...s, title: editTitle, description: editDescription } : s
    );
    onUpdate({ generatedStories: updated });
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const selectedCount = data.generatedStories.filter((s) => s.selected).length;

  return (
    <div className="space-y-6">
      {data.generatedStories.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-4">
            Ready to generate {data.storyCount} user stories
          </p>
          {error && (
            <p className="text-red-500 text-sm mb-4">{error}</p>
          )}
          <button
            type="button"
            onClick={generateStories}
            disabled={isGenerating}
            className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isGenerating ? "Generating..." : "Generate Stories"}
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">
                {data.generatedStories.length} stories generated
              </p>
              <p className="text-sm text-muted-foreground">
                {selectedCount} selected
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  onUpdate({ generatedStories: [] });
                  onRegenerate();
                }}
                className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
              >
                Regenerate
              </button>
              <button
                type="button"
                onClick={selectAll}
                className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
              >
                {data.generatedStories.every((s) => s.selected)
                  ? "Deselect all"
                  : "Select all"}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {data.generatedStories.map((story) => (
              <div
                key={story.id}
                className={`rounded-lg border p-4 transition-colors ${
                  story.selected ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                {editingId === story.id ? (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full rounded-md border border-border px-3 py-2 text-sm font-medium"
                      placeholder="Story title"
                    />
                    <textarea
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      rows={3}
                      className="w-full rounded-md border border-border px-3 py-2 text-sm"
                      placeholder="Story description"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => saveEdit(story.id)}
                        className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={story.selected}
                      onChange={() => toggleSelect(story.id)}
                      className="mt-1 h-4 w-4 cursor-pointer"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{story.title}</span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                            PRIORITY_COLORS[story.priority]
                          }`}
                        >
                          {story.priority}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {story.description}
                      </p>
                      <button
                        type="button"
                        onClick={() => startEdit(story)}
                        className="mt-2 text-xs text-primary hover:underline"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="flex justify-between pt-4 border-t border-border">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
        >
          Back
        </button>
        {data.generatedStories.length > 0 && (
          <button
            type="button"
            onClick={onNext}
            disabled={selectedCount === 0}
            className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Next ({selectedCount} selected)
          </button>
        )}
      </div>
    </div>
  );
}