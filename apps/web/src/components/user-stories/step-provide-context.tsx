"use client";

import { useState } from "react";
import { WizardData } from "./user-stories-wizard";

const SERVICES = [
  { id: "notion", label: "Notion" },
  { id: "slack", label: "Slack" },
  { id: "google_docs", label: "Google Docs" },
  { id: "gmail", label: "Gmail" },
  { id: "drive", label: "Google Drive" },
  { id: "airtable", label: "Airtable" },
];

interface Props {
  data: WizardData;
  onUpdate: (updates: Partial<WizardData>) => void;
  onNext: () => void;
}

export default function StepProvideContext({ data, onUpdate, onNext }: Props) {
  const [error, setError] = useState<string | null>(null);

  const toggleService = (serviceId: string) => {
    const current = data.selectedServices;
    if (current.includes(serviceId)) {
      onUpdate({ selectedServices: current.filter((s) => s !== serviceId) });
    } else {
      onUpdate({ selectedServices: [...current, serviceId] });
    }
  };

  const handleNext = () => {
    if (!data.description.trim()) {
      setError("Please describe the product or feature");
      return;
    }
    setError(null);
    onNext();
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="block text-sm font-semibold mb-2">
          Describe the product or feature
        </p>
        <textarea
          value={data.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          placeholder="Describe the product, feature, or epic you want user stories for..."
          rows={5}
          className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      </div>

      <div>
        <p className="block text-sm font-semibold mb-2">Upload documents</p>
        <div className="rounded-lg border-2 border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Upload PRDs, specs, or meeting notes (.docx, .pdf, .md, .txt)
          </p>
          <p className="text-xs text-muted-foreground mt-1">Coming soon</p>
        </div>
      </div>

      <div>
        <p className="block text-sm font-semibold mb-2">
          Pull from connected services
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SERVICES.map((service) => (
            <button
              key={service.id}
              type="button"
              onClick={() => toggleService(service.id)}
              className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm transition-colors ${
                data.selectedServices.includes(service.id)
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-muted"
              }`}
            >
              <span className="text-muted-foreground">↔</span>
              {service.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Select services to pull relevant context from.
        </p>
      </div>

      <div className="flex justify-between pt-4 border-t border-border">
        <a
          href="/generate"
          className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
        >
          Back
        </a>
        <button
          type="button"
          onClick={handleNext}
          className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Next
        </button>
      </div>
    </div>
  );
}