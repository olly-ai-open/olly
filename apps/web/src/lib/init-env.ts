import { SSMClient, GetParametersCommand } from "@aws-sdk/client-ssm";

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
  if (
    process.env.OPENAI_API_KEY ||
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

      // OpenAI
      `OPENAI_API_KEY`,
      `OPENAI_MODEL`,
      `OPENAI_TEMPERATURE`,

      // Supabase
      `SUPABASE_URL`,
      `SUPABASE_ANON_KEY`,
      `SUPABASE_SERVICE_KEY`,

      // Vapid
      `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
      `VAPID_PUBLIC_KEY`,
      `VAPID_PRIVATE_KEY`,
    ].map((key) => `/olly/${stage}/${key}`);

    const response = await ssmClient.send(
      new GetParametersCommand({
        Names: parameterNames,
        WithDecryption: true,
      }),
    );

    // Inject parameters into process.env
    response.Parameters?.forEach((param) => {
      if (param.Name && param.Value) {
        // Extract the key name from the parameter path
        const key = param.Name.split("/").pop();
        if (key) {
          process.env[key] = param.Value;
        }
      }
    });

    // Log missing parameters
    const foundParams = response.Parameters?.map((p) => p.Name) || [];
    const missingParams = parameterNames.filter(
      (name) => !foundParams.includes(name),
    );

    const requiredParams = [
      `/olly/${stage}/PRISMA_DATABASE_URL`,
      `/olly/${stage}/PRISMA_FIELD_ENCRYPTION_KEY`,
      `/olly/${stage}/NEXTAUTH_URL`,
      `/olly/${stage}/NEXTAUTH_SECRET`,
      `/olly/${stage}/GOOGLE_CLIENT_ID`,
      `/olly/${stage}/GOOGLE_CLIENT_SECRET`,
      `/olly/${stage}/OPENAI_API_KEY`,
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
