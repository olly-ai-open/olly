import { PrismaClient } from "@prisma/client";
import { fieldEncryptionExtension } from "prisma-field-encryption";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

let prismaPromise: Promise<ExtendedPrismaClient> | null = null;

const ssmClient = new SSMClient({});

type ExtendedPrismaClient = PrismaClient;

function createPrismaClient(dbUrl: string, encryptionKey: string): ExtendedPrismaClient {
  const base = new PrismaClient({
    datasourceUrl: dbUrl,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
  return base.$extends(
    fieldEncryptionExtension({
      encryptionKey,
    }),
  ) as unknown as PrismaClient;
}

async function resolveEncryptionKey(): Promise<string> {
  const paramName = process.env.PRISMA_FIELD_ENCRYPTION_KEY_PARAM;
  if (!paramName) {
    throw new Error("Missing PRISMA_FIELD_ENCRYPTION_KEY_PARAM");
  }

  const resp = await ssmClient.send(
    new GetParameterCommand({
      Name: paramName,
      WithDecryption: true,
    }),
  );

  const value = resp.Parameter?.Value;
  if (!value || !value.trim().length) {
    throw new Error(`Empty or missing value for SSM parameter ${paramName}`);
  }

  return value;
}

async function resolveDatabaseUrlKey(): Promise<string> {
  const paramName = process.env.PRISMA_DATABASE_URL_PARAM;
  if (!paramName) {
    throw new Error("Missing PRISMA_DATABASE_URL_PARAM");
  }

  const resp = await ssmClient.send(
    new GetParameterCommand({
      Name: paramName,
      WithDecryption: true,
    }),
  );

  const value = resp.Parameter?.Value;
  if (!value || !value.trim().length) {
    throw new Error(`Empty or missing value for SSM parameter ${paramName}`);
  }

  return value;
}

export async function getPrisma(): Promise<ExtendedPrismaClient> {
  if (!prismaPromise) {
    prismaPromise = (async () => {
      const encryptionKey = await resolveEncryptionKey();
      const dbUrl = await resolveDatabaseUrlKey();
      return createPrismaClient(dbUrl, encryptionKey);
    })();
  }
  return prismaPromise;
}
