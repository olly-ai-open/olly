'use client';

import { useRouter } from 'next/navigation';

interface ConversationStartersProps {
  onSelect: (text: string) => void;
}

const STARTERS = [
  {
    text: 'Create my monthly marketing report',
    icon: '📊',
    description: 'Summarize marketing activities and metrics',
    link: null,
  },
  {
    text: 'Summarize our conversations about ___ into a wiki',
    icon: '📚',
    description: 'Synthesize discussions into a knowledge article',
    link: null,
  },
  {
    text: 'Give me a status update on my projects',
    icon: '📋',
    description: 'Progress report on current work',
    link: null,
  },
  {
    text: 'Generate user stories for a feature',
    icon: '✏️',
    description: 'Create user stories from PRDs, specs, and context',
    link: '/generate/user-stories',
  },
];

export default function ConversationStarters({
  onSelect,
}: ConversationStartersProps) {
  const router = useRouter();

  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">
        Or try one of these:
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {STARTERS.map((starter, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => {
              if (starter.link) {
                router.push(starter.link);
              } else {
                onSelect(starter.text);
              }
            }}
            className="group rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
          >
            <span className="mb-2 block text-2xl">{starter.icon}</span>
            <span className="block text-sm font-medium leading-snug">
              {starter.text}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {starter.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}