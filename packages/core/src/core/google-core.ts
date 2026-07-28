import type { PrismaClient } from "@prisma/client";
import type { GoogleAccountLike } from "../google-http";
import { getOAuthClient } from "../google-http";

export async function getAccessTokenFromAccountCore(
  prisma: PrismaClient,
  account: GoogleAccountLike & { id?: string; userId?: string },
  options?: { forceRefresh?: boolean },
): Promise<string> {
  const oAuth2Client = getOAuthClient();
  const expiresAt = account.expires_at ? account.expires_at * 1000 : undefined;

  const now = Date.now();
  // Refresh a few minutes early: Google often rejects tokens before expires_at,
  // and waiting for a 401 adds a full failed round-trip on every first load.
  const skewMs = 5 * 60 * 1000;
  const isExpired = options?.forceRefresh
    ? true
    : expiresAt
      ? now >= expiresAt - skewMs
      : false;

  oAuth2Client.setCredentials({
    access_token: account.access_token || undefined,
    refresh_token: account.refresh_token || undefined,
    expiry_date: expiresAt,
    scope: (account.scope ?? undefined) as string | undefined,
    token_type: (account.token_type ?? undefined) as any,
    id_token: account.id_token || undefined,
  });

  try {
    if (isExpired || !account.access_token) {
      if (!account.refresh_token) {
        throw new Error("REAUTH_REQUIRED");
      }

      try {
        const { credentials } = await oAuth2Client.refreshAccessToken();

        if (account.id && credentials.access_token) {
          const newExpiresAt = credentials.expiry_date
            ? Math.floor(credentials.expiry_date / 1000)
            : null;

          await prisma.account.update({
            where: { id: account.id },
            data: {
              access_token: credentials.access_token,
              expires_at: newExpiresAt,
              token_type: credentials.token_type || account.token_type,
              scope: credentials.scope || account.scope,
              id_token: credentials.id_token || account.id_token,
            },
          });
        }

        return credentials.access_token!;
      } catch (refreshError: any) {
        if (
          refreshError?.response?.data?.error === "invalid_grant" ||
          refreshError?.message?.includes("invalid_grant") ||
          refreshError?.code === 400
        ) {
          if (account.id) {
            await prisma.account.update({
              where: { id: account.id },
              data: {
                access_token: null,
                refresh_token: null,
                expires_at: null,
              },
            });
          }
          throw new Error("REAUTH_REQUIRED");
        }
        throw refreshError;
      }
    }

    return account.access_token!;
  } catch (error: any) {
    if (error.message === "REAUTH_REQUIRED") {
      throw error;
    }
    throw error;
  }
}
