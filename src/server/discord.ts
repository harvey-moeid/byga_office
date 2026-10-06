import { MARKET, formatPrice, formatWib, type GroupSnapshot, type Signal } from "../core/contracts";
import { composition, groupComposition } from "../core/engine";
import type { Env } from "./env";
import type { CaseRow } from "./office";
import type { ScannerOutput } from "../core/contracts";
export function discordPayload(
  row: CaseRow,
  kind: string,
  origin: string,
  signal?: Signal,
) {
  const snapshot = JSON.parse(row.context) as { scanners: ScannerOutput[]; groups?: GroupSnapshot[] };
  const c = composition(snapshot.scanners);
  const groups = snapshot.groups?.length ? groupComposition(snapshot.groups) : null;
  let content =
    kind === "MEETING"
      ? `AI OFFICE MEETING STARTED\n${MARKET} · ${row.direction ?? "Neutral"}\n${groups ? `Groups: ${groups.BUY} BUY / ${groups.SELL} SELL / ${groups.NONE} NONE\n` : ""}Scanners: ${c.BUY} BUY / ${c.SELL} SELL / ${c.NONE} NONE\nPrice: ${(JSON.parse(row.context) as { market: { M5: { close: number }[] } }).market.M5.at(-1)?.close ?? "—"}\n${row.id} · ${formatWib(row.created_at)}\n${origin}/cases/${row.id}`
      : kind === "NO_CONSENSUS"
        ? `NO_CONSENSUS · ${row.id}\n${origin}/cases/${row.id}`
        : signal
          ? `${signal.direction} · ${signal.market} · ${signal.signal_id}\nCase: ${row.id}\nEntry Zone: ${formatPrice(signal.entry_low, signal.tick_size)} – ${formatPrice(signal.entry_high, signal.tick_size)}\nPreferred Entry: ${formatPrice(signal.preferred_entry, signal.tick_size)}\nTP: ${formatPrice(signal.take_profit, signal.tick_size)} · SL: ${formatPrice(signal.stop_loss, signal.tick_size)}\nR:R 1:${signal.risk_reward.toFixed(2)} · Confidence ${Math.round(signal.confidence)}%\nGroups: ${JSON.stringify(signal.group_composition)}\nScanners: ${JSON.stringify(signal.scanner_composition)}\nAI votes: ${JSON.stringify(signal.ai_vote_composition)}\nBoss: ${signal.boss_summary.slice(0, 400)}\n${signal.flags.includes("LOW_RR") ? `⚠ LOW R:R — 1:${signal.risk_reward.toFixed(2)} (minimum 1:${signal.minimum_risk_reward.toFixed(2)})\n` : ""}${signal.flags.join(" · ")}\n${formatWib(signal.created_at)}\n${origin}/signals/${signal.signal_id}`
          : "";
  content = content.slice(0, 1950);
  return { content, allowed_mentions: { parse: [] } };
}
export async function notify(
  env: Env,
  row: CaseRow,
  kind: "MEETING" | "SIGNAL" | "NO_CONSENSUS",
  enabled: boolean,
  signal?: Signal,
) {
  if (!enabled || row.mode === "SIMULATION") return;
  const key = `${row.uuid}:${kind}`;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO discord_deliveries(key,case_uuid,kind,status,payload,created_at) VALUES (?,?,?,'PENDING',?,?)",
  )
    .bind(
      key,
      row.uuid,
      kind,
      JSON.stringify(discordPayload(row, kind, env.PUBLIC_ORIGIN, signal)),
      Date.now(),
    )
    .run();
  await retryDeliveries(env);
}
export async function retryDeliveries(env: Env, fetcher: typeof fetch = fetch) {
  await env.DB.prepare(
    "UPDATE discord_deliveries SET status='UNKNOWN',last_error='Worker interrupted during delivery; manual review required' WHERE status='SENDING' AND COALESCE(last_attempt_at,created_at)<?",
  )
    .bind(Date.now() - 30000)
    .run();
  const rows = await env.DB.prepare(
    "SELECT key,kind,payload,attempts FROM discord_deliveries WHERE status='PENDING' AND attempts<4 AND next_attempt_at<=? ORDER BY created_at LIMIT 10",
  )
    .bind(Date.now())
    .all<{ key: string; kind: string; payload: string; attempts: number }>();
  for (const r of rows.results) {
    const url =
      r.kind === "SIGNAL"
        ? env.DISCORD_SIGNAL_WEBHOOK
        : env.DISCORD_MEETING_WEBHOOK;
    if (!url) continue;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      await env.DB.prepare(
        "UPDATE discord_deliveries SET status='FAILED',last_error='Invalid webhook destination' WHERE key=? AND status='PENDING'",
      )
        .bind(r.key)
        .run();
      continue;
    }
    const productionWebhook =
      parsed.hostname === "discord.com" &&
      parsed.pathname.startsWith("/api/webhooks/");
    const testWebhook =
      env.APP_ENV === "test" &&
      parsed.hostname === "discord.invalid" &&
      parsed.pathname.startsWith("/webhooks/");
    if (
      parsed.protocol !== "https:" ||
      (!productionWebhook && !testWebhook)
    ) {
      await env.DB.prepare(
        "UPDATE discord_deliveries SET status='FAILED',last_error='Invalid webhook destination' WHERE key=?",
      )
        .bind(r.key)
        .run();
      continue;
    }
    // Reserve before sending: a network interruption is ambiguous and must be reviewed, not blindly resent.
    const claimed = await env.DB.prepare(
      "UPDATE discord_deliveries SET status='SENDING',attempts=attempts+1,last_attempt_at=? WHERE key=? AND status='PENDING' AND attempts<4 AND next_attempt_at<=?",
    )
      .bind(Date.now(), r.key, Date.now())
      .run();
    if (!claimed.meta.changes) continue;
    try {
      const res = await fetcher(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: r.payload,
        signal: AbortSignal.timeout(10000),
      });
      const status = res.ok
        ? "SENT"
        : res.status >= 500
          ? "UNKNOWN"
          : res.status === 429 && r.attempts + 1 < 4
            ? "PENDING"
            : "FAILED";
      const retryAfter = Number(res.headers.get("Retry-After"));
      const nextAttempt =
        Date.now() +
        Math.max(
          30000,
          Number.isFinite(retryAfter) ? retryAfter * 1000 : 30000,
        );
      await env.DB.prepare(
        "UPDATE discord_deliveries SET status=?,last_error=?,next_attempt_at=? WHERE key=? AND status='SENDING'",
      )
        .bind(
          status,
          res.ok ? null : `HTTP ${res.status}`,
          status === "PENDING" ? nextAttempt : 0,
          r.key,
        )
        .run();
    } catch {
      await env.DB.prepare(
        "UPDATE discord_deliveries SET status='UNKNOWN',last_error='Delivery ambiguous; manual review required' WHERE key=?",
      )
        .bind(r.key)
        .run();
    }
  }
}

export async function reviewDelivery(
  env: Env,
  key: string,
  action: "MARK_SENT" | "DISMISS" | "RETRY",
) {
  const id = crypto.randomUUID();
  const allowed = action === "RETRY" ? ["FAILED"] : ["UNKNOWN", "FAILED"];
  const status =
    action === "MARK_SENT"
      ? "SENT"
      : action === "DISMISS"
        ? "DISMISSED"
        : "PENDING";
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE discord_deliveries SET status=?,attempts=CASE WHEN ?='RETRY' THEN 0 ELSE attempts END,next_attempt_at=0,last_error=NULL,review_id=? WHERE key=? AND status IN (${allowed.map(() => "?").join(",")})`,
    ).bind(status, action, id, key, ...allowed),
    env.DB.prepare(
      "INSERT INTO discord_delivery_reviews SELECT ?,key,?,? FROM discord_deliveries WHERE key=? AND review_id=?",
    ).bind(id, action, Date.now(), key, id),
  ]);
  return !!results[0].meta.changes;
}
