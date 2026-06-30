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

let sdk: NodeSDK | null = null;
let initialized = false;
let enabled = false;
let langfuseProcessor: LangfuseSpanProcessor | null = null;

function canEnable(): boolean {
  return Boolean(
    process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY,
  );
}

export function ensureLangfuseInitialized(): boolean {
  const envReady = canEnable();
  // No keys (e.g. the desktop build, which strips telemetry creds): stay
  // completely silent — this runs on every agent/tool/generation call.
  if (!envReady) return false;
  console.log("[langfuse] init check", {
    initialized,
    enabled,
    envReady,
  });
  try {
    if (initialized && enabled) return true;
    initialized = true;
    console.log("[langfuse] initializing");
    const shouldExportSpan: ShouldExportSpan = ({ otelSpan }) => {
      const scopeName = otelSpan.instrumentationScope?.name || "";
      return scopeName !== "next.js";
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
    console.log("[langfuse] initialized");
  } catch (error) {
    console.warn("Langfuse telemetry init failed", error);
    enabled = false;
    initialized = false;
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
    enabled?: boolean;
  },
  fn: (span: Observation | null) => Promise<T>
): Promise<T> {
  if (params.enabled === false) {
    return fn(null);
  }
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
  enabled?: boolean;
}): Observation | null {
  if (params.enabled === false) return null;
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
    console.log("[langfuse] forceFlush start");
    await langfuseProcessor.forceFlush();
    console.log("[langfuse] forceFlush done");
  } catch (error) {
    console.warn("Langfuse telemetry flush failed", error);
  }
}
