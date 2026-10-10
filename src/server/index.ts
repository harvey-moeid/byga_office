import {
  analysisGroups,
  characterIds,
  caseStopMessage,
  configSchema,
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
import {
  boundedBody,
  errorResponse,
  HttpError,
  methodNotAllowed,
  readJsonObject,
} from "./http";
import type { OfficeState } from "../core/api";
import { privateText, redactPrivateAnalysis } from "./publication";
export { Office } from "./office";
const adminMethods: Record<string, string[]> = {
  "/config": ["GET", "POST"],
  "/characters": ["GET", "POST"],
  "/providers": ["GET", "POST"],
  "/prompts": ["GET"],
  "/rollback": ["POST"],
  "/models": ["POST"],
  "/test-provider": ["POST"],
  "/scan": ["POST"],
  "/emergency": ["POST"],
  "/simulation": ["POST"],
  "/usage": ["GET"],
  "/deliveries": ["GET"],
  "/deliveries/review": ["POST"],
  "/cases": ["GET"],
  "/simulation/history": ["GET"],
  "/health": ["GET"],
};
async function office(
  env: Env,
  path: string,
  body?: unknown,
  method = body !== undefined ? "POST" : "GET",
) {
  return env.OFFICE.get(
    env.OFFICE.idFromName(
      path === "/simulation" ? `${MARKET}:simulation` : MARKET,
    ),
  ).fetch(
    new Request(`https://office.internal${path}`, {
      method,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      headers: { "Content-Type": "application/json" },
    }),
  );
}
async function officeState(env: Env) {
  const response = await office(env, "/state");
  if (!response.ok)
    throw new HttpError(503, "Office state unavailable", "OFFICE_UNAVAILABLE");
  return {
    ...((await response.json()) as OfficeState),
    group_names: analysisGroups,
  };
}
async function marketProcessingDelay(env: Env) {
  const response = await office(env, "/config");
  if (!response.ok) throw new Error("Active trading config unavailable");
  const body = (await response.json()) as { config: unknown };
  return configSchema.parse(body.config).processingDelaySeconds * 1000;
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
          const state = await officeState(env);
          if (stopped) return;
          controller.enqueue(
            encoder.encode(`event: office\ndata: ${JSON.stringify(state)}\n\n`),
          );
        } catch {
          if (stopped) return;
          controller.enqueue(
            encoder.encode("event: unavailable\ndata: {}\n\n"),
          );
        }
        if (!stopped) timer = setTimeout(emit, 5000);
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
        reason?: unknown;
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
    stop_reason: caseStopMessage(result?.reason),
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
  if (
    [
      "/api/v1/auth/login",
      "/api/v1/auth/logout",
      "/api/v1/auth/session",
    ].includes(path)
  ) {
    const methods = [path.endsWith("/session") ? "GET" : "POST"];
    if (!methods.includes(request.method)) return methodNotAllowed(methods);
  }
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
    const action = path.slice("/api/v1/admin".length);
    const methods =
      adminMethods[action] ??
      (/^\/(?:cases|simulation)\/[^/]+$/.test(action) ? ["GET"] : undefined);
    if (!methods) return json({ error: "Not found" }, 404);
    if (!methods.includes(request.method)) return methodNotAllowed(methods);
    if (request.method !== "GET" && !sameOrigin(request, env))
      return json({ error: "Origin rejected" }, 403);
    if (action === "/deliveries/review" && request.method === "POST") {
      const body = (await readJsonObject(request)) as {
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
        request.method === "GET" ? undefined : await readJsonObject(request),
        request.method,
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
        office: await (await office(env, "/diagnostics")).json(),
        configured: providers.map((id) => ({
          id,
          configured: isProviderConfigured(env, id),
        })),
      });
    return json({ error: "Not found" }, 404);
  }
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
  if (path === "/api/v1/health") {
    let chart = "DOWN";
    try {
      const delay = await marketProcessingDelay(env);
      await readMarket(env, Date.now(), 260, delay);
      chart = "OK";
    } catch (error) {
      // Freshness lag is operational degradation, not a broken binding/schema.
      // Runtime market reads remain strict and still reject stale candles.
      if (
        error instanceof Error &&
        /^Stale (H1|M15|M5) data$/.test(error.message)
      )
        chart = "DEGRADED";
      /* Public health deliberately excludes schema/SQL/config error details. */
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
    return json(await officeState(env));
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
      "SELECT uuid,id,status FROM cases WHERE mode='LIVE' AND status IN ('COMPLETED','NO_CONSENSUS','FAILED','CONFIG_CHANGED','STALE') AND updated_at>=? ORDER BY updated_at DESC,created_at DESC LIMIT 1",
    )
      .bind(Date.now() - 180000)
      .first<{ uuid: string; id: string; status: string }>();
    if (!current) return json({ meeting: null });
    const outputs = await env.DB.prepare(
      "SELECT snapshot FROM ai_character_outputs WHERE case_uuid=?",
    )
      .bind(current.uuid)
      .all<{ snapshot: string }>();
    const { config } = (await (await office(env, "/config")).json()) as {
      config: { publicSignals: boolean };
    };
    const visible = admin || config.publicSignals;
    const turns = meetingTurns(outputs.results.map((row) => row.snapshot));
    return json({
      meeting: {
        case_id: current.id,
        status: current.status,
        finished: [
          "COMPLETED",
          "NO_CONSENSUS",
          "FAILED",
          "CONFIG_CHANGED",
          "STALE",
        ].includes(current.status),
        cancelled: ["FAILED", "CONFIG_CHANGED", "STALE"].includes(
          current.status,
        ),
        ...turns,
        prices_private: !visible,
        turns: turns.turns.map((turn) => ({
          ...turn,
          analysis: visible
            ? turn.analysis
            : redactPrivateAnalysis(turn.analysis),
        })),
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
    const byId = new Map(
      characters.map((character) => [character.id, character]),
    );
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
    const { config } = (await (await office(env, "/config")).json()) as {
      config: { publicSignals: boolean };
    };
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
          summary:
            admin || config.publicSignals
              ? a.output?.summary
              : a.output?.summary
                ? privateText(a.output.summary)
                : undefined,
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
      const delay = await marketProcessingDelay(env);
      const m = await readMarket(env, Date.now(), 260, delay);
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
    const rawPage = url.searchParams.get("page");
    const page = rawPage === null ? 1 : Number(rawPage),
      size = 20;
    if (
      (!rawPage && rawPage !== null) ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 10000
    )
      return json(
        {
          error: "Page must be an integer between 1 and 10000",
          code: "INVALID_PAGE",
        },
        400,
      );
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
    const times: Partial<Record<"from" | "to", number>> = {};
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
      if (v) {
        const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(v);
        const timestamp = dateOnly
          ? Date.parse(`${v}T00:00:00+07:00`)
          : Date.parse(v);
        if (
          !Number.isFinite(timestamp) ||
          (dateOnly &&
            new Date(timestamp + 7 * 3600000).toISOString().slice(0, 10) !==
              v) ||
          (!dateOnly && !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(v))
        )
          return json(
            {
              error:
                "Date filters require YYYY-MM-DD or a timestamp with timezone",
              code: "INVALID_DATE_RANGE",
            },
            400,
          );
        conditions.push(`created_at ${operator} ?`);
        times[p] = timestamp + (p === "to" && dateOnly ? 86400000 - 1 : 0);
        values.push(times[p]!);
      }
    }
    if (
      times.from !== undefined &&
      times.to !== undefined &&
      times.from > times.to
    )
      return json(
        { error: "From must not be after To", code: "INVALID_DATE_RANGE" },
        400,
      );
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
    if (!config.publicSignals && !admin)
      safe.analysts = safe.analysts.map((a) => ({
        ...a,
        summary: a.summary ? privateText(a.summary) : undefined,
      }));
    return json(safe);
  }
  return json({ error: "Not found" }, 404);
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let limit: Awaited<ReturnType<typeof consumeApiLimit>> = null;
    let routed: Response;
    try {
      try {
        limit = await consumeApiLimit(request, env);
      } catch {
        throw new HttpError(
          503,
          "API temporarily unavailable",
          "API_UNAVAILABLE",
        );
      }
      if (limit?.blocked) routed = limitedResponse(limit);
      else {
        if (new URL(request.url).pathname.startsWith("/api/"))
          await boundedBody(request);
        routed = await route(request, env);
      }
    } catch (error) {
      routed = errorResponse(error);
    }
    const response = new Response(routed.body, routed);
    limitHeaders(response, limit);
    response.headers.set("Referrer-Policy", "same-origin");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; worker-src 'self' blob:",
    );
    return response;
  },
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      office(env, "/schedule", {
        scheduledTime: controller.scheduledTime,
      }).then(async (response) => {
        await response.arrayBuffer();
        if (!response.ok) throw new Error("Scheduled scanner request failed");
      }),
    );
  },
};
