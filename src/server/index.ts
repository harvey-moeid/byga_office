import {
  analysisGroups,
  characterIds,
  MARKET,
  providers,
  scannerNames,
  wibDate,
  type Signal,
} from "../core/contracts";
import { reviewDelivery } from "./discord";
import { consumeApiLimit, limitHeaders, limitedResponse } from "./rate-limit";
import { isAdmin, json, login, logout, sameOrigin } from "./auth";
import type { Env } from "./env";
import { isProviderConfigured } from "./providers";
import { chartSchema, readMarket } from "./market";
import type { CaseRow } from "./office";
import { meetingTurns } from "../core/meeting";
export { Office } from "./office";
async function office(
  env: Env,
  path: string,
  body?: unknown,
  method = body ? "POST" : "GET",
) {
  return env.OFFICE.get(
    env.OFFICE.idFromName(
      path === "/simulation" ? `${MARKET}:simulation` : MARKET,
    ),
  ).fetch(
    new Request(`https://office.internal${path}`, {
      method,
      body: body ? JSON.stringify(body) : undefined,
      headers: { "Content-Type": "application/json" },
    }),
  );
}
function officeEvents(request: Request, env: Env) {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const stop = () => {
        if (stopped) return;
        stopped = true;
        clearTimeout(timer);
        try {
          controller.close();
        } catch {
          // The client can cancel while an office-state request is in flight.
        }
      };
      request.signal.addEventListener("abort", stop, { once: true });
      const emit = async () => {
        if (stopped) return;
        try {
          const state = await office(env, "/state");
          if (!state.ok) throw new Error("Office state unavailable");
          controller.enqueue(
            encoder.encode(`event: office\ndata: ${await state.text()}\n\n`),
          );
        } catch {
          controller.enqueue(
            encoder.encode("event: unavailable\ndata: {}\n\n"),
          );
        }
        timer = setTimeout(emit, 5000);
      };
      await emit();
    },
    cancel() {
      stopped = true;
      clearTimeout(timer);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
export function publicSignal(signal: Signal) {
  const {
    basis: _basis,
    signal_uuid: _signalUuid,
    case_uuid: _caseUuid,
    ...safe
  } = signal;
  return {
    ...safe,
    flags: safe.flags.filter(
      (f) => !["MODEL_FALLBACK_USED", "SEMANTIC_VALIDATION_FAILED"].includes(f),
    ),
  };
}
function publicCase(row: CaseRow) {
  const result = row.result
    ? (JSON.parse(row.result) as {
        signal?: Signal;
        analysts?: {
          id: string;
          status: string;
          output?: { vote: string; confidence: number; summary: string };
          flags: string[];
        }[];
      })
    : null;
  return {
    id: row.id,
    status: row.status,
    direction: row.direction,
    created_at: row.created_at,
    updated_at: row.updated_at,
    source: row.source,
    signal: result?.signal ? publicSignal(result.signal) : null,
    analysts:
      result?.analysts?.map((a) => ({
        id: a.id,
        status: a.status,
        vote: a.output?.vote,
        confidence: a.output?.confidence,
        summary: a.output?.summary,
        warning: a.flags.includes("SEMANTIC_VALIDATION_FAILED")
          ? "AI response quality issue detected"
          : null,
      })) ?? [],
  };
}
async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname.replace(/\/$/, "");
  if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (path === "/api/v1/auth/login" && request.method === "POST")
    return login(request, env);
  const admin = await isAdmin(request, env);
  if (path === "/api/v1/auth/session") return json({ admin });
  if (path === "/api/v1/auth/logout" && request.method === "POST") {
    if (!sameOrigin(request, env))
      return json({ error: "Origin rejected" }, 403);
    return logout(request, env);
  }
  if (path.startsWith("/api/v1/admin")) {
    if (!admin) return json({ error: "Admin authentication required" }, 401);
    if (request.method !== "GET" && !sameOrigin(request, env))
      return json({ error: "Origin rejected" }, 403);
    const action = path.slice("/api/v1/admin".length);
    if (action === "/deliveries/review" && request.method === "POST") {
      const body = (await request.json()) as {
        key?: unknown;
        action?: unknown;
        confirmed?: unknown;
      };
      if (
        typeof body.key !== "string" ||
        body.key.length > 200 ||
        !["MARK_SENT", "DISMISS", "RETRY"].includes(String(body.action)) ||
        body.confirmed !== true
      )
        return json(
          { error: "Delivery review requires a valid action and confirmation" },
          400,
        );
      const changed = await reviewDelivery(
        env,
        body.key,
        body.action as "MARK_SENT" | "DISMISS" | "RETRY",
      );
      if (changed && body.action === "RETRY") await office(env, "/wake");
      return changed
        ? json({ ok: true })
        : json(
            {
              error:
                "Delivery changed or action is not allowed; ambiguous deliveries cannot be retried",
            },
            409,
          );
    }
    const allowed = [
      "/config",
      "/characters",
      "/prompts",
      "/rollback",
      "/providers",
      "/models",
      "/test-provider",
      "/emergency",
      "/simulation",
      "/scan",
    ];
    if (allowed.includes(action))
      return office(
        env,
        action === "/scan" ? "/tick" : action,
        request.method === "GET" ? undefined : await request.json(),
        request.method === "GET" ? "GET" : "POST",
      );
    if (action === "/usage")
      return json(
        (await env.DB.prepare("SELECT * FROM usage_daily WHERE day=?")
          .bind(wibDate())
          .first()) ?? { day: wibDate(), calls: 0, tokens: 0 },
      );
    if (action === "/deliveries")
      return json(
        (
          await env.DB.prepare(
            "SELECT key,kind,status,attempts,last_error,created_at,last_attempt_at,next_attempt_at,review_id FROM discord_deliveries ORDER BY created_at DESC LIMIT 100",
          ).all()
        ).results,
      );
    if (action === "/cases")
      return json(
        (
          await env.DB.prepare(
            "SELECT id,status,direction,source,mode,created_at FROM cases WHERE mode='LIVE' ORDER BY created_at DESC LIMIT 100",
          ).all()
        ).results,
      );
    if (action === "/simulation/history")
      return json(
        (
          await env.DB.prepare(
            "SELECT c.id,c.status,c.created_at,s.replay_mode,s.config_mode FROM cases c JOIN simulation_runs s ON s.case_uuid=c.uuid ORDER BY c.created_at DESC LIMIT 100",
          ).all()
        ).results,
      );
    if (action.startsWith("/cases/") || action.startsWith("/simulation/")) {
      const id = decodeURIComponent(action.split("/").at(-1)!);
      const row = await env.DB.prepare("SELECT * FROM cases WHERE id=?")
        .bind(id)
        .first<CaseRow>();
      const events = row
        ? (
            await env.DB.prepare(
              "SELECT status,created_at FROM case_events WHERE case_uuid=? ORDER BY rowid",
            )
              .bind(row.uuid)
              .all()
          ).results
        : [];
      return row
        ? json({
            ...row,
            events,
            context: JSON.parse(row.context),
            result: row.result ? JSON.parse(row.result) : null,
          })
        : json({ error: "Case not found" }, 404);
    }
    if (action === "/health")
      return json({
        providers: await (await office(env, "/providers")).json(),
        discordMeeting: !!env.DISCORD_MEETING_WEBHOOK,
        discordSignal: !!env.DISCORD_SIGNAL_WEBHOOK,
        configured: providers.map((id) => ({
          id,
          configured: isProviderConfigured(env, id),
        })),
      });
    return json({ error: "Not found" }, 404);
  }
  if (request.method !== "GET")
    return json({ error: "Method not allowed" }, 405);
  if (path === "/api/v1/health") {
    let chart = "DOWN";
    try {
      await readMarket(env);
      chart = "OK";
    } catch {
      /* Public health deliberately excludes schema/SQL errors. */
    }
    const states = (await (await office(env, "/providers")).json()) as {
      state: string;
      failures: number;
    }[];
    const configured = providers.filter((id) =>
      isProviderConfigured(env, id),
    ).length;
    return json({
      chart_db: chart,
      api: "OK",
      ai_providers: !configured
        ? "DOWN"
        : states.some((p) => p.state === "OPEN" || p.failures > 0)
          ? "DEGRADED"
          : "OK",
      discord:
        env.DISCORD_MEETING_WEBHOOK && env.DISCORD_SIGNAL_WEBHOOK
          ? "CONFIGURED"
          : "NOT_CONFIGURED",
    });
  }
  if (path === "/api/v1/office/events") return officeEvents(request, env);
  if (path === "/api/v1/office/state") {
    const response = await office(env, "/state");
    if (!response.ok) return response;
    const state = (await response.json()) as Record<string, unknown>;
    return json({ ...state, group_names: analysisGroups });
  }
  if (path === "/api/v1/office/meeting") {
    const activeStatuses =
      "'REVALIDATING','AI_ANALYSIS','AI_DEGRADED','RISK_REVIEW','BOSS_REVIEW','SIGNAL_CREATED'";
    let current = await env.DB.prepare(
      `SELECT uuid,id,status FROM cases WHERE mode='LIVE' AND status IN (${activeStatuses}) ORDER BY created_at LIMIT 1`,
    ).first<{ uuid: string; id: string; status: string }>();
    // Keep a just-finished meeting available long enough for the visual dialogue
    // to finish, even when the actual AI pipeline completes between UI polls.
    current ??= await env.DB.prepare(
      "SELECT uuid,id,status FROM cases WHERE mode='LIVE' AND status IN ('COMPLETED','NO_CONSENSUS','FAILED','CONFIG_CHANGED') AND updated_at>=? ORDER BY created_at DESC LIMIT 1",
    )
      .bind(Date.now() - 180000)
      .first<{ uuid: string; id: string; status: string }>();
    if (!current) return json({ meeting: null });
    const outputs = await env.DB.prepare(
      "SELECT snapshot FROM ai_character_outputs WHERE case_uuid=?",
    )
      .bind(current.uuid)
      .all<{ snapshot: string }>();
    return json({
      meeting: {
        case_id: current.id,
        status: current.status,
        finished: [
          "COMPLETED",
          "NO_CONSENSUS",
          "FAILED",
          "CONFIG_CHANGED",
        ].includes(current.status),
        cancelled: ["FAILED", "CONFIG_CHANGED"].includes(current.status),
        ...meetingTurns(outputs.results.map((row) => row.snapshot)),
      },
    });
  }
  if (path === "/api/v1/scanners") {
    const state = (await (await office(env, "/state")).json()) as {
      scanners: unknown[];
    };
    return json(state.scanners);
  }
  if (path === "/api/v1/characters") {
    const characters = (await (await office(env, "/characters")).json()) as {
      id: string;
      avatar: string;
    }[];
    const byId = new Map(characters.map((character) => [character.id, character]));
    return json(
      characterIds.map((id) => {
        const character = byId.get(id);
        if (!character) throw new Error(`Character config missing: ${id}`);
        return { id: character.id, avatar: character.avatar };
      }),
    );
  }
  if (path.startsWith("/api/v1/scanners/")) {
    const id = path.split("/").at(-1);
    const rows = await env.DB.prepare(
      "SELECT snapshot FROM scanner_outputs WHERE name=? ORDER BY rowid DESC LIMIT 30",
    )
      .bind(id)
      .all<{ snapshot: string }>();
    return json(rows.results.map((r) => JSON.parse(r.snapshot)));
  }
  if (path.startsWith("/api/v1/characters/")) {
    const id = path.split("/").at(-1);
    const rows = await env.DB.prepare(
      "SELECT a.snapshot,c.id AS case_id,c.updated_at FROM ai_character_outputs a JOIN cases c ON c.uuid=a.case_uuid WHERE a.character_id=? AND c.mode='LIVE' ORDER BY c.created_at DESC LIMIT 20",
    )
      .bind(id)
      .all<{ snapshot: string; case_id: string; updated_at: number }>();
    return json(
      rows.results.map((row) => {
        const a = JSON.parse(row.snapshot);
        return {
          id: a.id,
          case_id: row.case_id,
          updated_at: row.updated_at,
          status: a.status,
          vote: a.output?.vote,
          confidence: a.output?.confidence,
          summary: a.output?.summary,
          ...(admin
            ? {
                provider: a.provider,
                model: a.model,
                prompt_version: a.prompt_version,
                validationErrors: a.validationErrors,
              }
            : {}),
          warning: a.flags.includes("SEMANTIC_VALIDATION_FAILED")
            ? "AI response quality issue detected"
            : null,
        };
      }),
    );
  }
  if (path === "/api/v1/market/status") {
    try {
      const m = await readMarket(env);
      return json({
        market: MARKET,
        development: env.APP_ENV !== "production" && env.APP_ENV !== "staging",
        price: m.M5.at(-1)!.close,
        tickSize:
          chartSchema.parse(JSON.parse(env.CHART_SCHEMA)).tickSize ?? 0.01,
        candle_timestamp: m.M5.at(-1)!.timestamp,
        timeframes: Object.fromEntries(
          Object.entries(m).map(([k, v]) => [k, v.slice(-100)]),
        ),
        status: "OK",
      });
    } catch (error) {
      console.error(
        "market_status_unavailable",
        error instanceof Error ? error.message : String(error),
      );
      return json(
        {
          market: MARKET,
          status: "DOWN",
          error:
            "Market data unavailable; check chart_db binding and candle schema",
        },
        503,
      );
    }
  }
  if (path === "/api/v1/signals" || path.startsWith("/api/v1/signals/")) {
    const { config } = (await (await office(env, "/config")).json()) as {
      config: {
        publicSignals: boolean;
        publicHistory: boolean;
        historyLimit: number;
      };
    };
    if (!config.publicSignals && !admin)
      return json({ error: "Admin authentication required" }, 401);
    if (path !== "/api/v1/signals") {
      const id = decodeURIComponent(path.split("/").at(-1)!);
      const row = await env.DB.prepare(
        "SELECT snapshot FROM signals WHERE id=?",
      )
        .bind(id)
        .first<{ snapshot: string }>();
      return row
        ? json(
            admin
              ? JSON.parse(row.snapshot)
              : publicSignal(JSON.parse(row.snapshot)),
          )
        : json({ error: "Signal not found" }, 404);
    }
    if (!config.publicHistory && !admin)
      return json({ items: [], total: 0, page: 1 });
    const page = Math.max(
        1,
        Math.min(10000, Number(url.searchParams.get("page")) || 1),
      ),
      size = 20;
    const conditions = ["1=1"],
      values: (string | number)[] = [];
    const direction = url.searchParams.get("direction");
    if (direction === "BUY" || direction === "SELL") {
      conditions.push("direction=?");
      values.push(direction);
    }
    for (const [param, field] of [
      ["case", "case_id"],
      ["id", "signal_id"],
      ["source", "source"],
    ] as const) {
      const v = url.searchParams.get(param);
      if (v) {
        conditions.push(`json_extract(snapshot,'$.${field}')=?`);
        values.push(v);
      }
    }
    for (const [p, operator] of [
      ["minConfidence", ">="],
      ["maxConfidence", "<="],
    ] as const) {
      const v = url.searchParams.get(p);
      if (v && Number.isFinite(Number(v))) {
        conditions.push(`confidence ${operator} ?`);
        values.push(Number(v));
      }
    }
    for (const [p, operator] of [
      ["from", ">="],
      ["to", "<="],
    ] as const) {
      const v = url.searchParams.get(p);
      if (v && Number.isFinite(Date.parse(v))) {
        conditions.push(`created_at ${operator} ?`);
        const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(v)
          ? Date.parse(`${v}T00:00:00+07:00`)
          : Date.parse(v);
        values.push(timestamp + (p === "to" ? 86400000 - 1 : 0));
      }
    }
    const flag = url.searchParams.get("flag");
    if (flag && ["LOW_RR", "COUNTER_TREND", "AI_DEGRADED"].includes(flag)) {
      conditions.push(
        "EXISTS (SELECT 1 FROM json_each(snapshot,'$.flags') WHERE value=?)",
      );
      values.push(flag);
    }
    const scanner = url.searchParams.get("scanner");
    if (scanner) {
      if (!scannerNames.includes(scanner as (typeof scannerNames)[number]))
        return json({ error: "Invalid scanner filter" }, 400);
      conditions.push(
        "EXISTS (SELECT 1 FROM cases c,json_each(c.context,'$.scanners') s WHERE c.uuid=signals.case_uuid AND json_extract(s.value,'$.name')=? AND json_extract(s.value,'$.direction')=signals.direction)",
      );
      values.push(scanner);
    }
    const where = conditions.join(" AND ");
    const limit = admin ? 10000 : config.historyLimit;
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM (SELECT * FROM signals ORDER BY created_at DESC LIMIT ?) AS signals WHERE ${where}`,
    )
      .bind(limit, ...values)
      .first<{ n: number }>();
    const rows = await env.DB.prepare(
      `SELECT snapshot FROM (SELECT * FROM signals ORDER BY created_at DESC LIMIT ?) AS signals WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(limit, ...values, size, (page - 1) * size)
      .all<{ snapshot: string }>();
    return json({
      items: rows.results.map((r) =>
        admin ? JSON.parse(r.snapshot) : publicSignal(JSON.parse(r.snapshot)),
      ),
      total: count!.n,
      page,
    });
  }
  if (/^\/api\/v1\/cases\/[^/]+\/public$/.test(path)) {
    const id = decodeURIComponent(path.split("/")[4]);
    const row = await env.DB.prepare(
      "SELECT * FROM cases WHERE id=? AND mode='LIVE'",
    )
      .bind(id)
      .first<CaseRow>();
    if (!row) return json({ error: "Case not found" }, 404);
    const { config } = (await (await office(env, "/config")).json()) as {
      config: { publicSignals: boolean };
    };
    const safe = publicCase(row);
    if (!safe.analysts.length) {
      const outputs = await env.DB.prepare(
        "SELECT snapshot FROM ai_character_outputs WHERE case_uuid=?",
      )
        .bind(row.uuid)
        .all<{ snapshot: string }>();
      safe.analysts = outputs.results.map((r) => {
        const a = JSON.parse(r.snapshot);
        return {
          id: a.id,
          status: a.status,
          vote: a.output?.vote,
          confidence: a.output?.confidence,
          summary: a.output?.summary,
          warning: a.flags.includes("SEMANTIC_VALIDATION_FAILED")
            ? "AI response quality issue detected"
            : null,
        };
      });
    }
    if (!config.publicSignals && !admin) safe.signal = null;
    return json(safe);
  }
  return json({ error: "Not found" }, 404);
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (Number(request.headers.get("Content-Length")) > 200000)
        return json({ error: "Request too large" }, 413);
      let limit;
      try {
        limit = await consumeApiLimit(request, env);
      } catch {
        return json({ error: "API temporarily unavailable" }, 503);
      }
      const routed = limit?.blocked
        ? limitedResponse(limit)
        : await route(request, env);
      const response = new Response(routed.body, routed);
      limitHeaders(response, limit);
      response.headers.set("Referrer-Policy", "same-origin");
      response.headers.set("X-Frame-Options", "DENY");
      response.headers.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; worker-src 'self' blob:",
      );
      return response;
    } catch {
      return json(
        { error: "Request failed. Check server configuration." },
        500,
      );
    }
  },
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      office(env, "/tick", {}).then(async (response) => {
        await response.arrayBuffer();
        if (!response.ok) throw new Error("Scheduled scanner request failed");
      }),
    );
  },
};
