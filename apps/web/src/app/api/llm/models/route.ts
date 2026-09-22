import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getDefaultLLMModel,
  getLLMProviderAvailability,
  isLLMProvider,
  type LLMProvider,
} from "@olly/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ModelOption = { id: string; label: string };

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<LLMProvider, { at: number; models: ModelOption[] }>();

/**
 * List the chat-capable models a provider currently offers, using the
 * deployment's key for that provider. Cached for an hour per provider so
 * opening Settings does not hit the provider every time.
 */
async function fetchModels(provider: LLMProvider): Promise<ModelOption[]> {
  switch (provider) {
    case "anthropic": {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY || "",
          "anthropic-version": "2023-06-01",
        },
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}`);
      const data = (await res.json()) as {
        data?: Array<{ id: string; display_name?: string }>;
      };
      return (data.data || []).map((m) => ({
        id: m.id,
        label: m.display_name ? `${m.display_name} (${m.id})` : m.id,
      }));
    }
    case "openai": {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY || ""}` },
      });
      if (!res.ok) throw new Error(`openai ${res.status}`);
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      return (data.data || [])
        .map((m) => m.id)
        .filter(
          (id) =>
            /^(gpt-|o\d)/.test(id) &&
            !/(audio|realtime|transcribe|tts|image|embedding|search|instruct|moderation)/.test(id),
        )
        .sort()
        .reverse()
        .map((id) => ({ id, label: id }));
    }
    case "gemini": {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(process.env.GEMINI_API_KEY || "")}`,
      );
      if (!res.ok) throw new Error(`gemini ${res.status}`);
      const data = (await res.json()) as {
        models?: Array<{
          name: string;
          displayName?: string;
          supportedGenerationMethods?: string[];
        }>;
      };
      return (data.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m) => {
          const id = m.name.replace(/^models\//, "");
          return { id, label: m.displayName ? `${m.displayName} (${id})` : id };
        })
        .filter((m) => /^gemini-/.test(m.id) && !/(tts|image|audio|embedding|robotics|transcribe)/.test(m.id));
    }
  }
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const provider = req.nextUrl.searchParams.get("provider");
  if (!isLLMProvider(provider)) {
    return NextResponse.json({ error: "invalid_provider" }, { status: 400 });
  }
  if (!getLLMProviderAvailability()[provider]) {
    return NextResponse.json({ error: "no_key_for_provider", models: [] }, { status: 200 });
  }

  const cached = cache.get(provider);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ models: cached.models, default: getDefaultLLMModel(provider) });
  }
  try {
    const models = await fetchModels(provider);
    cache.set(provider, { at: Date.now(), models });
    return NextResponse.json({ models, default: getDefaultLLMModel(provider) });
  } catch (err) {
    console.error(`[llm/models] ${provider} list failed:`, err);
    // The form falls back to a free-text model field.
    return NextResponse.json({ error: "list_failed", models: [], default: getDefaultLLMModel(provider) });
  }
}
