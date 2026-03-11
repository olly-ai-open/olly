export function authorizeCronRequest(req: Request): {
  ok: boolean;
  status: number;
  error?: string;
} {
  if (process.env.CRON_ENABLED === "false") {
    return { ok: false, status: 503, error: "cron_disabled" };
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV !== "production") {
      return { ok: true, status: 200 };
    }
    return { ok: false, status: 500, error: "cron_secret_not_configured" };
  }

  const authHeader = req.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  if (authHeader !== expected) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  return { ok: true, status: 200 };
}
