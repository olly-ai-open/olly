import { SSMClient, GetParametersCommand } from "@aws-sdk/client-ssm";

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
      `PRISMA_DATABASE_URL_PARAM`,
      `PRISMA_FIELD_ENCRYPTION_KEY_PARAM`,      
    ].map(key => `/olly/${stage}/${key}`);
    
    const response = await ssmClient.send(
      new GetParametersCommand({
        Names: parameterNames,
        WithDecryption: true,
      })
    );
    
    // Inject parameters into process.env
    response.Parameters?.forEach(param => {
      if (param.Name && param.Value) {
        // Extract the key name from the parameter path
        const key = param.Name.split("/").pop();
        if (key) {
          process.env[key] = param.Value;
        }
      }
    });
    
    // Log missing parameters (optional ones might not exist)
    const foundParams = response.Parameters?.map(p => p.Name) || [];
    const missingParams = parameterNames.filter(name => !foundParams.includes(name));
    
    const requiredParams = [
      `/olly/${stage}/PRISMA_DATABASE_URL_PARAM`,
      `/olly/${stage}/PRISMA_FIELD_ENCRYPTION_KEY_PARAM`,
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