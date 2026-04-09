"use client";

import { WizardData } from "./user-stories-wizard";

interface Props {
  data: WizardData;
  onUpdate: (updates: Partial<WizardData>) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function StepConfigure({ data, onUpdate, onNext, onBack }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <p className="block text-sm font-semibold mb-2">
          Number of user stories to generate
        </p>
        <select
          value={data.storyCount}
          onChange={(e) => onUpdate({ storyCount: Number(e.target.value) })}
          className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm"
        >
          <option value={3}>3 stories</option>
          <option value={5}>5 stories</option>
          <option value={8}>8 stories</option>
          <option value={10}>10 stories</option>
        </select>
      </div>

      <div>
        <p className="block text-sm font-semibold mb-2">Story format</p>
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-lg border border-border p-4 cursor-pointer hover:bg-muted">
            <input
              type="checkbox"
              checked={data.includeAcceptanceCriteria}
              onChange={(e) => onUpdate({ includeAcceptanceCriteria: e.target.checked })}
              className="h-4 w-4"
            />
            <div>
              <div className="text-sm font-medium">Include acceptance criteria</div>
              <div className="text-xs text-muted-foreground">
                Add detailed acceptance criteria for each user story
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <p className="block text-sm font-semibold mb-2">Story format preview</p>
        <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Example story:</p>
          <p className="mt-2">
            <span className="font-medium">Title:</span> User login with email
          </p>
          <p className="mt-1">
            <span className="font-medium">Description:</span> As a registered user,
            I want to log in with my email and password, so that I can access my
            personalized dashboard.
          </p>
          {data.includeAcceptanceCriteria && (
            <div className="mt-2">
              <p className="font-medium">Acceptance Criteria:</p>
              <ul className="mt-1 list-disc pl-4 space-y-1">
                <li>User can enter email and password</li>
                <li>System validates credentials</li>
                <li>User is redirected to dashboard on success</li>
              </ul>
            </div>
          )}
        </div>
      </div>

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
          onClick={onNext}
          className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Next
        </button>
      </div>
    </div>
  );
}
