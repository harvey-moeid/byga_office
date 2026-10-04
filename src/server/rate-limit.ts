import { digest, json } from "./auth";
import type { Env } from "./env";

// Separate read/write budgets allow polling while limiting mutations. Cloudflare
// supplies CF-Connecting-IP; never trust client-selected forwarded IP headers.
export const apiLimits = { read: 240, write: 30, windowMs: 60000 } as const;
export interface ApiLimit {
  limit: number;
  remaining: number;
  resetAt: number;
  blocked: boolean;
}
export async function consumeApiLimit(
  request: Request,
  env: Pick<Env, "DB">,
  now = Date.now(),
): Promise<ApiLimit | null> {
  if (
    !new URL(request.url).pathname.startsWith("/api/") ||
    request.method === "OPTIONS"
  )
    return null;
  const group = ["GET", "HEAD"].includes(request.method) ? "read" : "write";
  const limit = apiLimits[group];
  const key = `${group}:${await digest(request.headers.get("CF-Connecting-IP") ?? "unknown")}`;
  const row = await env.DB.prepare(
    "INSERT INTO api_limits(key,attempts,reset_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE MIN(attempts+1,?) END, reset_at=CASE WHEN reset_at<=? THEN ? ELSE reset_at END RETURNING attempts,reset_at",
  )
    .bind(
      key,
      now + apiLimits.windowMs,
      now,
      limit + 1,
      now,
      now + apiLimits.windowMs,
    )
    .first<{ attempts: number; reset_at: number }>();
  if (!row) throw new Error("API limit unavailable");
  return {
    limit,
    remaining: Math.max(0, limit - row.attempts),
    resetAt: row.reset_at,
    blocked: row.attempts > limit,
  };
}
export function limitedResponse(limit: ApiLimit, now = Date.now()) {
  const response = json(
    { error: "Terlalu banyak permintaan. Coba lagi setelah jeda." },
    429,
  );
  response.headers.set(
    "Retry-After",
    String(Math.max(1, Math.ceil((limit.resetAt - now) / 1000))),
  );
  return response;
}
export function limitHeaders(response: Response, limit: ApiLimit | null) {
  if (!limit) return;
  response.headers.set("X-RateLimit-Limit", String(limit.limit));
  response.headers.set("X-RateLimit-Remaining", String(limit.remaining));
  response.headers.set(
    "X-RateLimit-Reset",
    String(Math.ceil(limit.resetAt / 1000)),
  );
}
