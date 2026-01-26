'use client';

interface Progress {
  stage: string;
  message: string;
  percent: number;
}

interface DocGenRequest {
  id: string;
  prompt: string;
  intent: any;
  status: string;
  progress: Progress | null;
  createdAt: string;
}

interface GenerationProgressProps {
  request: DocGenRequest;
  onCancel: () => void;
}

const STAGES = [
  { key: 'gathering', label: 'Gathering information', icon: '🔍' },
  { key: 'analyzing', label: 'Analyzing findings', icon: '🔬' },
  { key: 'synthesizing', label: 'Synthesizing document', icon: '✍️' },
  { key: 'creating', label: 'Finalizing', icon: '📄' },
];

function getStageIndex(status: string): number {
  const idx = STAGES.findIndex((s) => s.key === status);
  return idx >= 0 ? idx : 0;
}

export default function GenerationProgress({
  request,
  onCancel,
}: GenerationProgressProps) {
  const progress = request.progress || { stage: 'gathering', message: 'Starting...', percent: 5 };
  const currentStageIndex = getStageIndex(progress.stage);

  return (
    <div className="rounded-lg border border-border bg-card p-8">
      {/* Header */}
      <div className="mb-8 text-center">
        <h2 className="text-xl font-semibold">Generating your document</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This usually takes 30-60 seconds
        </p>
      </div>

      {/* Progress bar */}
      <div className="mb-8">
        <div className="mb-2 flex justify-between text-sm">
          <span className="font-medium">{progress.message}</span>
          <span className="text-muted-foreground">{progress.percent}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      </div>

      {/* Stage indicators */}
      <div className="mb-8 flex justify-between">
        {STAGES.map((stage, idx) => {
          const isCompleted = idx < currentStageIndex;
          const isCurrent = idx === currentStageIndex;
          const isPending = idx > currentStageIndex;

          return (
            <div
              key={stage.key}
              className={`flex flex-col items-center ${
                isPending ? 'opacity-40' : ''
              }`}
            >
              <div
                className={`mb-2 flex h-10 w-10 items-center justify-center rounded-full text-lg ${
                  isCompleted
                    ? 'bg-success/20 text-success'
                    : isCurrent
                      ? 'animate-pulse bg-primary/20 text-primary'
                      : 'bg-border text-muted-foreground'
                }`}
              >
                {isCompleted ? '✓' : stage.icon}
              </div>
              <span className="text-center text-xs font-medium">
                {stage.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Prompt preview */}
      {request.prompt && (
        <div className="rounded-lg bg-muted/50 p-4">
          <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
            Your request
          </p>
          <p className="text-sm">{request.prompt}</p>
        </div>
      )}

      {/* Cancel button */}
      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-muted-foreground underline hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
