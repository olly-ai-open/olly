"use client";

import { useState } from "react";
import StepProvideContext from "./step-provide-context";
import StepConfigure from "./step-configure";
import StepReviewStories from "./step-review-stories";
import StepSelectExport from "./step-select-export";
import StepExport from "./step-export";

export interface UserStory {
  id: string;
  title: string;
  description: string;
  priority: "Critical" | "High" | "Medium" | "Low";
  selected: boolean;
}

export interface WizardData {
  description: string;
  selectedServices: string[];
  storyCount: number;
  includeAcceptanceCriteria: boolean;
  generatedStories: UserStory[];
  exportDestination: "jira" | "notion" | "csv" | "markdown" | null;
}

const STEPS = [
  { number: 1, label: "Provide\nContext" },
  { number: 2, label: "Configure" },
  { number: 3, label: "Review\nStories" },
  { number: 4, label: "Select\nExport" },
  { number: 5, label: "Export" },
];

export default function UserStoriesWizard() {
  const [currentStep, setCurrentStep] = useState(1);
  const [wizardData, setWizardData] = useState<WizardData>({
    description: "",
    selectedServices: [],
    storyCount: 5,
    includeAcceptanceCriteria: true,
    generatedStories: [],
    exportDestination: null,
  });

  const updateData = (updates: Partial<WizardData>) => {
    setWizardData((prev) => ({ ...prev, ...updates }));
  };

  const nextStep = () => setCurrentStep((s) => Math.min(s + 1, 5));
  const prevStep = () => setCurrentStep((s) => Math.max(s - 1, 1));

  return (
    <div className="space-y-8">
      <div>
        <a href="/generate" className="text-sm text-muted-foreground hover:text-foreground">
          Back
        </a>
        <h1 className="mt-2 text-2xl font-bold">User Stories Generator</h1>
        <p className="text-sm text-muted-foreground">
          Create user stories from your documents and inputs
        </p>
      </div>

      <div className="flex items-center justify-between">
        {STEPS.map((step, idx) => (
          <div key={step.number} className="flex items-center flex-1">
            <div className="flex flex-col items-center">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                  currentStep > step.number
                    ? "bg-primary text-primary-foreground"
                    : currentStep === step.number
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {currentStep > step.number ? "✓" : step.number}
              </div>
              <div className="mt-1 text-center text-xs text-muted-foreground whitespace-pre-line">
                {step.label}
              </div>
            </div>
            {idx < STEPS.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-2 ${
                  currentStep > step.number ? "bg-primary" : "bg-muted"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      <div>
        {currentStep === 1 && (
          <StepProvideContext
            data={wizardData}
            onUpdate={updateData}
            onNext={nextStep}
          />
        )}
        {currentStep === 2 && (
          <StepConfigure
            data={wizardData}
            onUpdate={updateData}
            onNext={nextStep}
            onBack={prevStep}
          />
        )}
        {currentStep === 3 && (
          <StepReviewStories
            data={wizardData}
            onUpdate={updateData}
            onNext={nextStep}
            onBack={prevStep}
            onRegenerate={() => setCurrentStep(1)}
          />
        )}
        {currentStep === 4 && (
          <StepSelectExport
            data={wizardData}
            onUpdate={updateData}
            onNext={nextStep}
            onBack={prevStep}
          />
        )}
        {currentStep === 5 && (
          <StepExport
            data={wizardData}
            onBack={prevStep}
          />
        )}
      </div>
    </div>
  );
}