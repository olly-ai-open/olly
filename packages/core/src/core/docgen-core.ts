import type { PrismaClient } from '@prisma/client';
import {
  DocGenAgent,
  type DocGenIntent,
  type Evidence,
  type GeneratedDocResult,
} from '../agents/personas/DocGenAgent';
import { getUserSettingsCore } from './settings-core';

/**
 * Input for creating a document generation request
 */
export interface DocGenRequestInput {
  userId: string;
  prompt: string;
  templateId?: string;
}

/**
 * Progress info for request status
 */
export interface DocGenProgress {
  stage: string;
  message: string;
  percent: number;
}

/**
 * Create a new document generation request
 */
export async function createDocGenRequestCore(
  prisma: PrismaClient,
  input: DocGenRequestInput
): Promise<{ requestId: string }> {
  const request = await prisma.docGenRequest.create({
    data: {
      userId: input.userId,
      prompt: input.prompt,
      templateId: input.templateId,
      status: 'pending',
    },
  });
  return { requestId: request.id };
}

/**
 * Update request status and progress
 */
async function updateRequestStatus(
  prisma: PrismaClient,
  requestId: string,
  status: string,
  message: string,
  percent: number
): Promise<void> {
  await prisma.docGenRequest.update({
    where: { id: requestId },
    data: {
      status,
      progress: { stage: status, message, percent } as any,
    },
  });
}

/**
 * Create a run record for a pipeline stage
 */
async function createDocGenRun(
  prisma: PrismaClient,
  requestId: string,
  stage: string,
  data: {
    evidence?: Evidence[];
    findings?: any;
    error?: string;
    metadata?: any;
  }
): Promise<void> {
  await prisma.docGenRun.create({
    data: {
      requestId,
      stage,
      status: data.error ? 'failed' : 'completed',
      evidence: data.evidence as any,
      findings: data.findings as any,
      error: data.error,
      metadata: data.metadata as any,
      completedAt: new Date(),
    },
  });
}

/**
 * Process a document generation request through the full pipeline
 */
export async function processDocGenRequestCore(
  prisma: PrismaClient,
  requestId: string
): Promise<{ documentId: string }> {
  // Load the request
  const request = await prisma.docGenRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { template: true },
  });

  // Load user settings
  const settings = await getUserSettingsCore(prisma, request.userId);

  // Create the agent
  const agent = new DocGenAgent({
    telemetryEnabled: settings.telemetryOptIn !== false,
  });

  try {
    // Stage 1: Parse Intent
    await updateRequestStatus(prisma, requestId, 'gathering', 'Understanding your request...', 5);
    const intent = await agent.parseIntent(request.prompt);

    // Store parsed intent
    await prisma.docGenRequest.update({
      where: { id: requestId },
      data: { intent: intent as any },
    });

    // Stage 2: Gather Evidence
    await updateRequestStatus(prisma, requestId, 'gathering', 'Searching your workspace...', 15);
    const evidence = await agent.gatherEvidence(
      request.userId,
      intent,
      async (stage, message, percent) => {
        await updateRequestStatus(prisma, requestId, stage, message, percent);
      }
    );

    // Record the gather run
    await createDocGenRun(prisma, requestId, 'gather', { evidence });

    // Stage 3: Analyze (optional stage for metrics/insights)
    await updateRequestStatus(prisma, requestId, 'analyzing', 'Analyzing findings...', 50);

    // Stage 4: Synthesize Document
    await updateRequestStatus(prisma, requestId, 'synthesizing', 'Creating your document...', 60);
    const template = request.template?.content || undefined;
    const result = await agent.synthesizeDocument(
      request.userId,
      intent,
      evidence,
      template,
      async (stage, message, percent) => {
        await updateRequestStatus(prisma, requestId, stage, message, percent);
      }
    );

    // Record the synthesize run
    await createDocGenRun(prisma, requestId, 'synthesize', {
      findings: { sections: result.sections.length, openQuestions: result.openQuestions.length },
    });

    // Stage 5: Create Document
    await updateRequestStatus(prisma, requestId, 'creating', 'Finalizing document...', 90);
    const document = await prisma.generatedDocument.create({
      data: {
        requestId,
        userId: request.userId,
        title: result.title,
        docType: intent.docType,
        content: {
          sections: result.sections,
          markdown: result.markdown,
        } as any,
        citations: Object.entries(result.citations).map(([id, ev]) => ({
          evidenceId: id,
          sourceType: ev.sourceType,
          sourceRef: ev.url || null,
          title: ev.title,
          snippet: ev.snippet,
        })) as any,
        openQuestions: result.openQuestions as any,
      },
    });

    // Record the create run
    await createDocGenRun(prisma, requestId, 'create', {
      metadata: { documentId: document.id },
    });

    // Mark as completed
    await updateRequestStatus(prisma, requestId, 'completed', 'Document ready!', 100);

    return { documentId: document.id };
  } catch (error: any) {
    // Mark as failed
    await updateRequestStatus(prisma, requestId, 'failed', error.message || 'Generation failed', 0);
    await createDocGenRun(prisma, requestId, 'error', { error: error.message });
    throw error;
  }
}

/**
 * Get a document generation request with its document
 */
export async function getDocGenRequestCore(
  prisma: PrismaClient,
  requestId: string,
  userId: string
): Promise<{
  request: any;
  document: any | null;
}> {
  const request = await prisma.docGenRequest.findFirst({
    where: { id: requestId, userId },
    include: {
      document: true,
      runs: {
        orderBy: { startedAt: 'desc' },
        take: 10,
      },
      template: {
        select: { id: true, name: true, docType: true },
      },
    },
  });

  if (!request) {
    throw new Error('Request not found');
  }

  return {
    request,
    document: request.document,
  };
}

/**
 * Get a generated document by ID
 */
export async function getGeneratedDocumentCore(
  prisma: PrismaClient,
  documentId: string,
  userId: string
): Promise<any> {
  const document = await prisma.generatedDocument.findFirst({
    where: { id: documentId, userId },
    include: {
      request: {
        select: { id: true, prompt: true, intent: true },
      },
    },
  });

  if (!document) {
    throw new Error('Document not found');
  }

  return document;
}

/**
 * Save (persist) a generated document
 */
export async function saveGeneratedDocumentCore(
  prisma: PrismaClient,
  documentId: string,
  userId: string
): Promise<void> {
  await prisma.generatedDocument.updateMany({
    where: { id: documentId, userId },
    data: { savedAt: new Date() },
  });
}

// ============ Template Management ============

/**
 * Upload a new template
 */
export async function uploadTemplateCore(
  prisma: PrismaClient,
  userId: string,
  input: {
    name: string;
    content: string;
    docType: string;
    description?: string;
    mimeType?: string;
  }
): Promise<{ templateId: string }> {
  const template = await prisma.templateProfile.create({
    data: {
      userId,
      name: input.name,
      content: input.content,
      docType: input.docType,
      description: input.description,
      mimeType: input.mimeType,
      templateSource: 'uploaded',
    },
  });
  return { templateId: template.id };
}

/**
 * Get templates available to a user
 */
export async function getTemplatesCore(
  prisma: PrismaClient,
  userId: string,
  docType?: string
): Promise<any[]> {
  return prisma.templateProfile.findMany({
    where: {
      OR: [{ userId }, { userId: null }], // User's + system templates
      docType: docType || undefined,
      isActive: true,
    },
    orderBy: [{ templateSource: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      description: true,
      docType: true,
      templateSource: true,
      mimeType: true,
      createdAt: true,
    },
  });
}

/**
 * Delete a user template
 */
export async function deleteTemplateCore(
  prisma: PrismaClient,
  templateId: string,
  userId: string
): Promise<void> {
  await prisma.templateProfile.deleteMany({
    where: {
      id: templateId,
      userId, // Only allow deleting own templates
      templateSource: 'uploaded', // Can't delete system templates
    },
  });
}

/**
 * List user's recent document generation requests
 */
export async function listDocGenRequestsCore(
  prisma: PrismaClient,
  userId: string,
  limit = 20
): Promise<any[]> {
  return prisma.docGenRequest.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      document: {
        select: { id: true, title: true, docType: true, savedAt: true },
      },
    },
  });
}
