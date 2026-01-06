import { SSMClient } from "@aws-sdk/client-ssm";
import { fetchSsmParameters } from "@olly/core";

/**
 * Initialize environment variables from AWS SSM Parameter Store
 * This runs once during Lambda cold start, before the handler executes
 */
export async function initializeEnvironment(): Promise<void> {
  // Skip if already initialized or in local development
  if (process.env.OPENAI_API_KEY || process.env.NODE_ENV === "development") {
    return;
  }

  const stage = process.env.STAGE || "prod";
  const region = process.env.AWS_REGION || "us-west-2";
  
  console.log(`Initializing environment from SSM for stage: ${stage}`);
  
  try {
    const ssmClient = new SSMClient({ region });
    
    // Define all parameters to fetch
    const parameterNames = [
      // Database & Encryption
      `PRISMA_DATABASE_URL`,
      `PRISMA_FIELD_ENCRYPTION_KEY`,
      
      // Google API
      `GOOGLE_CLIENT_ID`,
      `GOOGLE_CLIENT_SECRET`,
      `NEXTAUTH_URL`,
      
      // OpenAI
      `OPENAI_API_KEY`,
      `OPENAI_MODEL`,
      `OPENAI_TEMPERATURE`,

      // Supabase
      `SUPABASE_URL`,
      `SUPABASE_ANON_KEY`,
      `SUPABASE_SERVICE_KEY`,
      
      // Vapid
      `VAPID_PUBLIC_KEY`,
      `VAPID_PRIVATE_KEY`,

      // Langfuse
      "LANGFUSE_SECRET_KEY",
      "LANGFUSE_PUBLIC_KEY",
      "LANGFUSE_BASE_URL",

    ].map(key => `/olly/${stage}/${key}`);
    
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
    
    // Log missing parameters (optional ones might not exist)
    const foundParams = allParameters.map((p) => p.Name);
    const missingParams = parameterNames.filter((name) => !foundParams.includes(name));
    
    const requiredParams = [
      `/olly/${stage}/PRISMA_DATABASE_URL`,
      `/olly/${stage}/PRISMA_FIELD_ENCRYPTION_KEY`,
      `/olly/${stage}/GOOGLE_CLIENT_ID`,
      `/olly/${stage}/GOOGLE_CLIENT_SECRET`,
      `/olly/${stage}/OPENAI_API_KEY`,
    ];
    
    const missingRequired = missingParams.filter(p => requiredParams.includes(p));
    
    if (missingRequired.length > 0) {
      console.error("Missing required SSM parameters:", missingRequired);
      throw new Error(`Missing required SSM parameters: ${missingRequired.join(", ")}`);
    }
    
    if (missingParams.length > 0) {
      console.log("Optional SSM parameters not found (this is OK):", missingParams);
    }
    
    console.log("Environment initialized successfully from SSM");
    
  } catch (error) {
    console.error("Failed to initialize environment from SSM:", error);
    throw error;
  }
}
