import { SSMClient } from "@aws-sdk/client-ssm";
import { fetchSsmParameters } from "@olly/core";

/**
 * Initialize server-side environment variables from AWS SSM Parameter Store
 * This is called during build time or server startup for Next.js
 */
export async function initializeServerEnvironment(): Promise<void> {
  // Skip on client-side
  if (typeof window !== "undefined") {
    return;
  }

  // Skip if already initialized or no AWS credentials available
  // Check for any LLM API key being set (indicates already initialized)
  const hasLLMKey =
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.GOOGLE_API_KEY;

  if (
    hasLLMKey ||
    !process.env.AWS_ACCESS_KEY_ID ||
    process.env.NODE_ENV === "development"
  ) {
    return;
  }

  const stage = process.env.STAGE || "prod";
  const region = process.env.AWS_REGION || "us-east-1";

  console.log(`[Vercel] Initializing environment from SSM for stage: ${stage}`);

  try {
    const ssmClient = new SSMClient({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });

    // Define all parameters to fetch for the web app
    const parameterNames = [
      // Database & Encryption
      `PRISMA_DATABASE_URL`,
      `PRISMA_FIELD_ENCRYPTION_KEY`,

      // Auth
      `NEXTAUTH_URL`,
      `NEXTAUTH_SECRET`,

      // Google API
      `GOOGLE_CLIENT_ID`,
      `GOOGLE_CLIENT_SECRET`,

      // LLM Provider
      `LLM_PROVIDER`,
      `LLM_TEMPERATURE`,

      // OpenAI
      `OPENAI_API_KEY`,
      `OPENAI_MODEL`,
      `OPENAI_TEMPERATURE`,

      // Anthropic
      `ANTHROPIC_API_KEY`,
      `ANTHROPIC_MODEL`,

      // Google (Gemini)
      `GOOGLE_API_KEY`,
      `GOOGLE_MODEL`,

      // Supabase
      `SUPABASE_URL`,
      `SUPABASE_ANON_KEY`,
      `SUPABASE_SERVICE_KEY`,

      // Vapid
      `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
      `VAPID_PUBLIC_KEY`,
      `VAPID_PRIVATE_KEY`,

      // Langfuse
      "LANGFUSE_SECRET_KEY",
      "LANGFUSE_PUBLIC_KEY",
      "LANGFUSE_BASE_URL",
    ].map((key) => `/olly/${stage}/${key}`);

    const allParameters = await fetchSsmParameters({
      parameterNames,
      region,
      client: ssmClient,
    });

    // Inject parameters into process.env
    allParameters.forEach((param) => {
      if (param.Name && param.Value) {
        // Extract the key name from the parameter path
        const key = param.Name.split("/").pop();
        if (key) {
          process.env[key] = param.Value;
        }
      }
    });

    // Log missing parameters
    const foundParams = allParameters.map((p) => p.Name);
    const missingParams = parameterNames.filter(
      (name) => !foundParams.includes(name),
    );

    // Determine which LLM API key is required based on provider
    const llmProvider = process.env.LLM_PROVIDER?.toLowerCase() || "openai";
    let llmApiKeyParam: string;
    switch (llmProvider) {
      case "anthropic":
        llmApiKeyParam = `/olly/${stage}/ANTHROPIC_API_KEY`;
        break;
      case "gemini":
        llmApiKeyParam = `/olly/${stage}/GOOGLE_API_KEY`;
        break;
      default:
        llmApiKeyParam = `/olly/${stage}/OPENAI_API_KEY`;
    }

    const requiredParams = [
      `/olly/${stage}/PRISMA_DATABASE_URL`,
      `/olly/${stage}/PRISMA_FIELD_ENCRYPTION_KEY`,
      `/olly/${stage}/NEXTAUTH_URL`,
      `/olly/${stage}/NEXTAUTH_SECRET`,
      `/olly/${stage}/GOOGLE_CLIENT_ID`,
      `/olly/${stage}/GOOGLE_CLIENT_SECRET`,
      llmApiKeyParam,
    ];

    const missingRequired = missingParams.filter((p) =>
      requiredParams.includes(p),
    );

    if (missingRequired.length > 0) {
      console.error(
        "[Vercel] Missing required SSM parameters:",
        missingRequired,
      );
      throw new Error(
        `Missing required SSM parameters: ${missingRequired.join(", ")}`,
      );
    }

    if (missingParams.length > 0) {
      console.log(
        "[Vercel] Optional SSM parameters not found (this is OK):",
        missingParams,
      );
    }

    console.log("[Vercel] Environment initialized successfully from SSM");
  } catch (error) {
    console.error("[Vercel] Failed to initialize environment from SSM:", error);
    throw error;
  }
}

// For Edge Runtime compatibility (if needed)
export async function initializeEdgeEnvironment(): Promise<void> {
  // Edge runtime has limited Node.js API access
  // For now, we'll rely on environment variables being set at build time
  console.log("[Edge] Using build-time environment variables");
}
