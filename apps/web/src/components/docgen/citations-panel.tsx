'use client';

interface Citation {
  evidenceId: string;
  sourceType: string;
  sourceRef: string | null;
  title: string;
  snippet: string;
}

interface CitationsPanelProps {
  citations: Citation[];
}

const SOURCE_ICONS: Record<string, string> = {
  email: '📧',
  drive: '📁',
  slack: '💬',
};

const SOURCE_LABELS: Record<string, string> = {
  email: 'Email',
  drive: 'Google Drive',
  slack: 'Slack',
};

export default function CitationsPanel({ citations }: CitationsPanelProps) {
  // Group by source type
  const grouped = citations.reduce(
    (acc, citation) => {
      const type = citation.sourceType;
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(citation);
      return acc;
    },
    {} as Record<string, Citation[]>
  );

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h4 className="mb-4 font-semibold">Sources</h4>

      <div className="space-y-6">
        {Object.entries(grouped).map(([sourceType, items]) => (
          <div key={sourceType}>
            <h5 className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <span>{SOURCE_ICONS[sourceType] || '📄'}</span>
              <span>{SOURCE_LABELS[sourceType] || sourceType}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                {items.length}
              </span>
            </h5>
            <ul className="space-y-2">
              {items.map((citation) => (
                <li
                  key={citation.evidenceId}
                  className="rounded-md border border-border/50 bg-muted/30 p-3"
                >
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <span className="text-sm font-medium">{citation.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {citation.evidenceId}
                    </span>
                  </div>
                  {citation.snippet && (
                    <p className="mb-2 line-clamp-2 text-xs text-muted-foreground">
                      {citation.snippet}
                    </p>
                  )}
                  {citation.sourceRef && (
                    <a
                      href={citation.sourceRef}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      View source
                      <span>↗</span>
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
