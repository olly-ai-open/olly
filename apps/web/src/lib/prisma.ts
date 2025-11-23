import { PrismaClient } from "@prisma/client";
import { fieldEncryptionExtension } from "prisma-field-encryption";

const createPrismaClient = (): PrismaClient => {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

  const encryptionKey = process.env.PRISMA_FIELD_ENCRYPTION_KEY;

  if (!encryptionKey) {
    return base;
  }

  // Cast to PrismaClient for callers; extension adds encryption hooks.
  return base.$extends(
    fieldEncryptionExtension({
      encryptionKey,
    }),
  ) as unknown as PrismaClient;
};

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
