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

function canEnable(): boolean {
  return Boolean(LANGFUSE_PUBLIC_KEY && LANGFUSE_SECRET_KEY);
}

export function ensureLangfuseInitialized(): boolean {
  if (initialized) return enabled;
  initialized = true;
  if (!canEnable()) return false;
  try {
    const shouldExportSpan: ShouldExportSpan | undefined = ({ otelSpan }) => {
      const attrs = otelSpan.attributes || {};
      const asString = JSON.stringify(attrs);
      return asString.includes('"source":"olly-agent"');
    };
    sdk = new NodeSDK({
      spanProcessors: [new LangfuseSpanProcessor({ shouldExportSpan })],
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
    return propagateAttributes(
      {
        userId: params.userId,
        sessionId: params.sessionId,
        metadata: {
          ...(params.metadata || {}),
          source: "olly-agent",
        },
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
