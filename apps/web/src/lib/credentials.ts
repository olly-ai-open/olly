import { prisma } from "@/lib/prisma";

export async function saveCredential(
  userId: string,
  provider: string,
  data: Record<string, string>
): Promise<void> {
  await prisma.credential.upsert({
    where: { userId_provider: { userId, provider } },
    update: { data: JSON.stringify(data) },
    create: { userId, provider, data: JSON.stringify(data) },
  });
}

export async function getCredential(
  userId: string,
  provider: string
): Promise<Record<string, string> | null> {
  try {
    const credential = await prisma.credential.findUnique({
      where: { userId_provider: { userId, provider } },
    });
    if (!credential) return null;
    return JSON.parse(credential.data);
  } catch {
    return null;
  }
}

export async function deleteCredential(
  userId: string,
  provider: string
): Promise<void> {
  await prisma.credential.deleteMany({
    where: { userId, provider },
  });
}

export async function hasCredential(
  userId: string,
  provider: string
): Promise<boolean> {
  const credential = await prisma.credential.findUnique({
    where: { userId_provider: { userId, provider } },
  });
  return !!credential;
}