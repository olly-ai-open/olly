import {
  SSMClient,
  GetParametersCommand,
  type GetParametersCommandOutput,
} from "@aws-sdk/client-ssm";

interface FetchSsmParametersOptions {
  parameterNames: string[];
  region: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  batchSize?: number;
  client?: SSMClient;
}

export async function fetchSsmParameters({
  parameterNames,
  region,
  credentials,
  batchSize = 10,
  client,
}: FetchSsmParametersOptions): Promise<
  NonNullable<GetParametersCommandOutput["Parameters"]>
> {
  const ssmClient =
    client ?? new SSMClient({ region, credentials: credentials ?? undefined });
  const allParameters: NonNullable<GetParametersCommandOutput["Parameters"]> =
    [];

  for (let i = 0; i < parameterNames.length; i += batchSize) {
    const batch = parameterNames.slice(i, i + batchSize);
    const response = await ssmClient.send(
      new GetParametersCommand({
        Names: batch,
        WithDecryption: true,
      }),
    );
    if (response.Parameters?.length) {
      allParameters.push(...response.Parameters);
    }
  }

  return allParameters;
}
