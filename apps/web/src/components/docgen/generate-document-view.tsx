'use client';

import { useState, useEffect, useCallback } from 'react';
import GenerateDocumentForm from './generate-document-form';
import GenerationProgress from './generation-progress';
import DocumentViewer from './document-viewer';

type ViewState = 'form' | 'progress' | 'result';

interface DocGenRequest {
  id: string;
  prompt: string;
  intent: any;
  status: string;
  progress: { stage: string; message: string; percent: number } | null;
  createdAt: string;
}

interface GeneratedDocument {
  id: string;
  title: string;
  docType: string;
  content: { sections: any[]; markdown: string };
  citations: any[];
  openQuestions: string[];
  savedAt: string | null;
  createdAt: string;
}

interface GenerateDocumentViewProps {
  userId: string;
}

export default function GenerateDocumentView({ userId }: GenerateDocumentViewProps) {
  const [viewState, setViewState] = useState<ViewState>('form');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [request, setRequest] = useState<DocGenRequest | null>(null);
  const [document, setDocument] = useState<GeneratedDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll for request status while in progress
  const pollStatus = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/docgen/requests/${id}`);
      const data = await res.json();

      if (!data.ok) {
        setError(data.error || 'Failed to get status');
        setViewState('form');
        return;
      }

      setRequest(data.request);

      if (data.document) {
        setDocument(data.document);
        setViewState('result');
        return;
      }

      if (data.request.status === 'completed') {
        setDocument(data.document);
        setViewState('result');
        return;
      }

      if (data.request.status === 'failed') {
        setError('Document generation failed. Please try again.');
        setViewState('form');
        return;
      }

      // Continue polling
      setTimeout(() => pollStatus(id), 2000);
    } catch (err) {
      console.error('Polling error:', err);
      setError('Connection error. Please try again.');
      setViewState('form');
    }
  }, []);

  // Start generation
  const handleSubmit = async (prompt: string, templateId?: string) => {
    setError(null);
    setViewState('progress');

    try {
      const res = await fetch('/api/docgen/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, templateId }),
      });
      const data = await res.json();

      if (!data.ok) {
        setError(data.error || 'Failed to start generation');
        setViewState('form');
        return;
      }

      setRequestId(data.requestId);
      pollStatus(data.requestId);
    } catch (err) {
      console.error('Submit error:', err);
      setError('Connection error. Please try again.');
      setViewState('form');
    }
  };

  // Reset to form
  const handleReset = () => {
    setViewState('form');
    setRequestId(null);
    setRequest(null);
    setDocument(null);
    setError(null);
  };

  // Save document
  const handleSave = async () => {
    if (!document) return;

    try {
      const res = await fetch(`/api/docgen/documents/${document.id}/save`, {
        method: 'POST',
      });
      const data = await res.json();

      if (data.ok) {
        setDocument({ ...document, savedAt: new Date().toISOString() });
      }
    } catch (err) {
      console.error('Save error:', err);
    }
  };

  return (
    <div className="min-h-[60vh]">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">Generate Document</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create status updates, reports, and wiki documents from your workspace data.
        </p>
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-6 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* View states */}
      {viewState === 'form' && (
        <GenerateDocumentForm onSubmit={handleSubmit} />
      )}

      {viewState === 'progress' && request && (
        <GenerationProgress
          request={request}
          onCancel={handleReset}
        />
      )}

      {viewState === 'progress' && !request && (
        <GenerationProgress
          request={{
            id: '',
            prompt: '',
            intent: null,
            status: 'pending',
            progress: { stage: 'gathering', message: 'Starting...', percent: 5 },
            createdAt: new Date().toISOString(),
          }}
          onCancel={handleReset}
        />
      )}

      {viewState === 'result' && document && (
        <DocumentViewer
          document={document}
          onSave={handleSave}
          onNewDocument={handleReset}
        />
      )}
    </div>
  );
}
