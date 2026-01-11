import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor, type ShouldExportSpan } from "@langfuse/otel";
import {
  propagateAttributes,
  startActiveObservation,
  startObservation,
} from "@langfuse/tracing";

type Observation = {
  update: (payload: any) => void;
  end: () => void;
};

const LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
const LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;

let sdk: NodeSDK | null = null;
let initialized = false;
let enabled = false;
let langfuseProcessor: LangfuseSpanProcessor | null = null;

function canEnable(): boolean {
  return Boolean(LANGFUSE_PUBLIC_KEY && LANGFUSE_SECRET_KEY);
}

export function ensureLangfuseInitialized(): boolean {
  if (initialized) return enabled;
  initialized = true;
  if (!canEnable()) return false;
  try {
    const shouldExportSpan: ShouldExportSpan = ({ otelSpan }) => {
      return otelSpan.instrumentationScope.name !== "next.js";
    };
    langfuseProcessor = new LangfuseSpanProcessor({
      exportMode: "immediate",
      shouldExportSpan,
    });
    sdk = new NodeSDK({
      spanProcessors: [langfuseProcessor],
    });
    sdk.start();
    enabled = true;
  } catch (error) {
    console.warn("Langfuse telemetry init failed", error);
    enabled = false;
  }
  return enabled;
}

export async function withLangfuseTrace<T>(
  params: {
    name: string;
    userId?: string;
    sessionId?: string;
    input?: any;
    metadata?: Record<string, any>;
  },
  fn: (span: Observation | null) => Promise<T>
): Promise<T> {
  if (!ensureLangfuseInitialized()) {
    return fn(null);
  }

  return startActiveObservation(params.name, async (span: Observation) => {
    const propagatedMetadata: Record<string, string> = {
      source: "olly-agent",
    };
    for (const [key, value] of Object.entries(params.metadata || {})) {
      if (typeof value === "string" && value.trim().length) {
        propagatedMetadata[key] = value;
      }
    }
    return propagateAttributes(
      {
        userId: params.userId,
        sessionId: params.sessionId,
        metadata: propagatedMetadata,
        traceName: params.name,
      },
      async () => {
        if (params.input !== undefined) {
          span.update({
            input: params.input,
            metadata: {
              ...(params.metadata || {}),
              source: "olly-agent",
            },
          });
        }
        return fn(span);
      }
    );
  });
}

export function startLangfuseObservation(params: {
  name: string;
  input?: any;
  metadata?: Record<string, any>;
  model?: string;
  asType?:
    | "span"
    | "generation"
    | "event"
    | "agent"
    | "tool"
    | "chain"
    | "retriever"
    | "evaluator"
    | "guardrail"
    | "embedding";
}): Observation | null {
  if (!ensureLangfuseInitialized()) return null;
  const attributes: Record<string, any> = {
    input: params.input,
    metadata: {
      ...(params.metadata || {}),
      source: "olly-agent",
    },
  };
  if (params.asType && params.asType !== "span" && params.model) {
    attributes.model = params.model;
  }
  const options =
    params.asType && params.asType !== "span"
      ? ({ asType: params.asType } as any)
      : undefined;
  const observation = startObservation(params.name, attributes, options);
  return observation as Observation;
}

export async function flushLangfuse(): Promise<void> {
  if (!langfuseProcessor || !enabled) return;
  try {
    await langfuseProcessor.forceFlush();
  } catch (error) {
    console.warn("Langfuse telemetry flush failed", error);
  }
}
