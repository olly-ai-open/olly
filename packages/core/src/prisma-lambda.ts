import { PrismaClient } from "@prisma/client";
import { fieldEncryptionExtension } from "prisma-field-encryption";

let prismaPromise: Promise<ExtendedPrismaClient> | null = null;

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

export async function getPrisma(): Promise<ExtendedPrismaClient> {
  if (!prismaPromise) {
    prismaPromise = (async () => {
      return createPrismaClient(
        process.env.PRISMA_DATABASE_URL || '',
        process.env.PRISMA_FIELD_ENCRYPTION_KEY || '',
      );
    })();
  }
  return prismaPromise;
}
