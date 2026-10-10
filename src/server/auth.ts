import type { Env } from "./env";
import { json, readJsonObject } from "./http";
export { json } from "./http";
export async function digest(s: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
function bytes(hex: string) {
  return new Uint8Array(hex.match(/.{2}/g)!.map((x) => parseInt(x, 16)));
}
export async function verifyPassword(password: string, encoded: string) {
  const [method, iterations, salt, expected] = encoded.split(":");
  if (
    method !== "pbkdf2-sha256" ||
    !/^\d+$/.test(iterations) ||
    Number(iterations) < 100000 ||
    Number(iterations) > 100000 ||
    !/^[a-f0-9]{32}$/.test(salt ?? "") ||
    !/^[a-f0-9]{64}$/.test(expected ?? "")
  )
    return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const actual = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: bytes(salt),
        iterations: Number(iterations),
      },
      key,
      256,
    ),
  );
  const target = bytes(expected);
  let mismatch = 0;
  for (let i = 0; i < actual.length; i++) mismatch |= actual[i] ^ target[i];
  return mismatch === 0;
}
export async function isAdmin(request: Request, env: Env) {
  const token = request.headers
    .get("Cookie")
    ?.match(/(?:^|;\s*)byga_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token) return false;
  const row = await env.DB.prepare(
    "SELECT expires_at FROM sessions WHERE token_hash = ?",
  )
    .bind(await digest(token))
    .first<{ expires_at: number }>();
  return !!row && row.expires_at > Date.now();
}
export function sameOrigin(request: Request, env: Env) {
  const origin = request.headers.get("Origin");
  return (
    origin === env.PUBLIC_ORIGIN ||
    (env.APP_ENV === "development" &&
      [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8787",
        "http://127.0.0.1:8787",
      ].includes(origin ?? ""))
  );
}
export async function login(request: Request, env: Env) {
  if (!sameOrigin(request, env)) return json({ error: "Origin rejected" }, 403);
  if (!env.ADMIN_PASSWORD_HASH)
    return json({ error: "Admin password has not been configured" }, 503);
  const now = Date.now(),
    key = await digest(request.headers.get("CF-Connecting-IP") ?? "local");
  const row = await env.DB.prepare(
    "INSERT INTO login_limits(key,attempts,reset_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END, reset_at=CASE WHEN reset_at<=? THEN ? ELSE reset_at END RETURNING attempts,reset_at",
  )
    .bind(key, now + 900000, now, now, now + 900000)
    .first<{ attempts: number; reset_at: number }>();
  if (row && row.attempts > 5)
    return json({ error: "Too many attempts. Try again in 15 minutes." }, 429);
  const body = await readJsonObject(request);
  if (
    typeof body.password !== "string" ||
    body.password.length > 1024 ||
    !(await verifyPassword(body.password, env.ADMIN_PASSWORD_HASH))
  )
    return json({ error: "Invalid credentials" }, 401);
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  await env.DB.prepare(
    "INSERT INTO sessions(token_hash,expires_at) VALUES (?,?)",
  )
    .bind(await digest(token), now + 8 * 3600000)
    .run();
  const response = json({ ok: true });
  response.headers.set(
    "Set-Cookie",
    `byga_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`,
  );
  return response;
}
export async function logout(request: Request, env: Env) {
  const token = request.headers
    .get("Cookie")
    ?.match(/byga_session=([a-f0-9]{64})/)?.[1];
  if (token)
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?")
      .bind(await digest(token))
      .run();
  const res = json({ ok: true });
  res.headers.set(
    "Set-Cookie",
    "byga_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
  );
  return res;
}
