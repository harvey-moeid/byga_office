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
  type ScannerOutput,
} from "../core/contracts";
import { reviewDelivery } from "./discord";
import { consumeApiLimit, limitHeaders, limitedResponse } from "./rate-limit";
import { isAdmin, json, login, logout, sameOrigin } from "./auth";
import type { Env } from "./env";
import { isProviderConfigured } from "./providers";
import { credentialInventory, resolveProviderEnv } from "./credentials";
import { chartSchema, readMarket } from "./market";
import { chartQuery, readChart } from "./chart";
import type { CaseRow } from "./office";
import { readOfficeMeetings } from "./meetings";
import {
  boundedBody,
  errorResponse,
  HttpError,
  methodNotAllowed,
  readJsonObject,
} from "./http";
import type { OfficeState } from "../core/api";
import { deleteHistory } from "./history";
import {
  privateText,
  redactScanner,
  redactOfficeState,
  redactMeeting,
} from "./publication";
export { Office } from "./office";
const adminMethods: Record<string, string[]> = {
  "/history/delete": ["POST"],
  "/config": ["GET", "POST"],
  "/characters": ["GET", "POST"],
  "/providers": ["GET", "POST"],
  "/credentials": ["GET", "POST"],
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
async function activeConfig(env: Env) {
  const response = await office(env, "/config");
  if (!response.ok) throw new HttpError(503, "Configuration unavailable");
  return configSchema.parse(
    ((await response.json()) as { config: unknown }).config,
  );
}
async function officeState(env: Env, admin = false) {
  const response = await office(env, "/state");
  if (!response.ok)
    throw new HttpError(503, "Office state unavailable", "OFFICE_UNAVAILABLE");
  const state = {
    ...((await response.json()) as OfficeState),
    group_names: [...analysisGroups],
  };
  return admin || (await activeConfig(env)).publicSignals
    ? state
    : redactOfficeState(state);
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
  const expiresAt = Date.now() + 5 * 60_000;
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
        if (Date.now() >= expiresAt) {
          stop();
          return;
        }
        try {
          const state = await officeState(env, await isAdmin(request, env));
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
    if (action === "/history/delete")
      return deleteHistory(env.DB, await readJsonObject(request));
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
      "/credentials",
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
            "SELECT id,status,direction,source,mode,created_at FROM cases WHERE mode='LIVE' AND NOT EXISTS (SELECT 1 FROM history_deletions h WHERE h.case_uuid=cases.uuid) ORDER BY created_at DESC LIMIT 100",
          ).all()
        ).results,
      );
    if (action === "/simulation/history")
      return json(
        (
          await env.DB.prepare(
            "SELECT c.id,c.status,c.created_at,s.replay_mode,s.config_mode FROM cases c JOIN simulation_runs s ON s.case_uuid=c.uuid WHERE NOT EXISTS (SELECT 1 FROM history_deletions h WHERE h.case_uuid=c.uuid) ORDER BY c.created_at DESC LIMIT 100",
          ).all()
        ).results,
      );
    if (action.startsWith("/cases/") || action.startsWith("/simulation/")) {
      const id = decodeURIComponent(action.split("/").at(-1)!);
      const row = await env.DB.prepare(
        "SELECT * FROM cases WHERE id=? AND NOT EXISTS (SELECT 1 FROM history_deletions h WHERE h.case_uuid=cases.uuid)",
      )
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
        configured: (await credentialInventory(env)).items.map(
          ({ id, configured }) => ({ id, configured }),
        ),
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
    const providerEnv = await resolveProviderEnv(env);
    const configured = providers.filter((id) =>
      isProviderConfigured(providerEnv, id),
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
    return json(await officeState(env, admin));
  }
  if (path === "/api/v1/office/meeting") {
    const requested =
      new URL(request.url).searchParams.get("current") ?? undefined;
    if (requested && !/^[A-Za-z0-9:_-]{1,128}$/.test(requested))
      throw new HttpError(400, "Invalid meeting ID", "INVALID_MEETING_ID");
    const config = await activeConfig(env);
    const result = await readOfficeMeetings(
      env,
      admin || config.publicSignals,
      requested,
    );
    // The current live meeting stays usable when historical browsing is disabled.
    if (requested && !admin && requested !== result.meeting?.case_id) {
      const allowed =
        config.publicHistory &&
        (await env.DB.prepare(
          "SELECT id FROM (SELECT id FROM cases WHERE mode='LIVE' AND NOT EXISTS (SELECT 1 FROM history_deletions h WHERE h.case_uuid=cases.uuid) ORDER BY created_at DESC,rowid DESC LIMIT ?) WHERE id=? UNION ALL SELECT id FROM (SELECT id FROM scanner_meetings WHERE NOT EXISTS (SELECT 1 FROM history_deletions h WHERE h.case_uuid=scanner_meetings.case_uuid) ORDER BY created_at DESC,rowid DESC LIMIT ?) WHERE id=?",
        )
          .bind(config.historyLimit, requested, config.historyLimit, requested)
          .first());
      if (!allowed) result.requested_meeting = null;
    }
    return json(
      admin || config.publicSignals
        ? result
        : {
            meeting: redactMeeting(result.meeting),
            ...(requested
              ? {
                  requested_meeting: redactMeeting(
                    result.requested_meeting ?? null,
                  ),
                }
              : {}),
          },
    );
  }
  if (path === "/api/v1/scanners") {
    const state = (await (await office(env, "/state")).json()) as {
      scanners: ScannerOutput[];
    };
    return json(
      admin || (await activeConfig(env)).publicSignals
        ? state.scanners
        : state.scanners.map(redactScanner),
    );
  }
  if (path === "/api/v1/characters") {
    const characters = (await (await office(env, "/characters")).json()) as {
      id: string;
      avatar: string;
      display_name?: string;
    }[];
    const byId = new Map(
      characters.map((character) => [character.id, character]),
    );
    return json(
      characterIds.map((id) => {
        const character = byId.get(id);
        if (!character) throw new Error(`Character config missing: ${id}`);
        return {
          id: character.id,
          avatar: character.avatar,
          ...(character.display_name
            ? { display_name: character.display_name }
            : {}),
        };
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
    const visible = admin || (await activeConfig(env)).publicSignals;
    return json(
      rows.results.map((r) =>
        visible
          ? JSON.parse(r.snapshot)
          : redactScanner(JSON.parse(r.snapshot)),
      ),
    );
  }
  if (path.startsWith("/api/v1/characters/")) {
    const id = path.split("/").at(-1);
    const config = await activeConfig(env);
    if (!admin && !config.publicHistory) return json([]);
    const rows = await env.DB.prepare(
      "SELECT a.snapshot,c.id AS case_id,c.updated_at FROM ai_character_outputs a JOIN cases c ON c.uuid=a.case_uuid WHERE a.character_id=? AND c.mode='LIVE' AND NOT EXISTS (SELECT 1 FROM history_deletions h WHERE h.case_uuid=c.uuid) AND (?=1 OR c.uuid IN (SELECT uuid FROM cases WHERE mode='LIVE' AND NOT EXISTS (SELECT 1 FROM history_deletions h WHERE h.case_uuid=cases.uuid) ORDER BY created_at DESC,rowid DESC LIMIT ?)) ORDER BY c.created_at DESC LIMIT 20",
    )
      .bind(id, admin ? 1 : 0, config.historyLimit)
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
  if (path === "/api/v1/market/candles") {
    if (!admin && !(await activeConfig(env)).publicSignals)
      return json({ error: "Market detail is private" }, 401);
    const now = Date.now();
    const query = chartQuery(url.searchParams, now);
    try {
      return json(
        await readChart(env, query, now, await marketProcessingDelay(env)),
      );
    } catch (error) {
      console.error(
        "chart_unavailable",
        error instanceof Error ? error.message : String(error),
      );
      return json(
        {
          error: "Data chart belum tersedia. Coba lagi nanti.",
          code: "CHART_UNAVAILABLE",
        },
        503,
      );
    }
  }
  if (path === "/api/v1/market/status") {
    if (!admin && !(await activeConfig(env)).publicSignals)
      return json({ error: "Market detail is private" }, 401);
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
      if (!admin && !config.publicHistory)
        return json({ error: "Signal not found" }, 404);
      const id = decodeURIComponent(path.split("/").at(-1)!);
      const row = await env.DB.prepare(
        admin
          ? "SELECT snapshot FROM signals WHERE id=? AND NOT EXISTS (SELECT 1 FROM history_deletions h WHERE h.case_uuid=signals.case_uuid)"
          : `SELECT snapshot FROM (SELECT * FROM signals WHERE NOT EXISTS (SELECT 1 FROM history_deletions h WHERE h.case_uuid=signals.case_uuid) ORDER BY created_at DESC,rowid DESC LIMIT ?) WHERE id=?`,
      )
        .bind(...(admin ? [id] : [config.historyLimit, id]))
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
    const conditions = [
        "NOT EXISTS (SELECT 1 FROM history_deletions h WHERE h.case_uuid=signals.case_uuid)",
      ],
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
      `SELECT COUNT(*) AS n FROM (SELECT * FROM signals WHERE NOT EXISTS (SELECT 1 FROM history_deletions h WHERE h.case_uuid=signals.case_uuid) ORDER BY created_at DESC LIMIT ?) AS signals WHERE ${where}`,
    )
      .bind(limit, ...values)
      .first<{ n: number }>();
    const rows = await env.DB.prepare(
      `SELECT snapshot FROM (SELECT * FROM signals WHERE NOT EXISTS (SELECT 1 FROM history_deletions h WHERE h.case_uuid=signals.case_uuid) ORDER BY created_at DESC LIMIT ?) AS signals WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
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
    if (!admin) {
      const config = await activeConfig(env);
      if (!config.publicHistory) return json({ error: "Case not found" }, 404);
      const allowed = await env.DB.prepare(
        "SELECT id FROM (SELECT id FROM cases WHERE mode='LIVE' AND NOT EXISTS (SELECT 1 FROM history_deletions h WHERE h.case_uuid=cases.uuid) ORDER BY created_at DESC,rowid DESC LIMIT ?) WHERE id=?",
      )
        .bind(config.historyLimit, id)
        .first();
      if (!allowed) return json({ error: "Case not found" }, 404);
    }
    const row = await env.DB.prepare(
      "SELECT * FROM cases WHERE id=? AND mode='LIVE' AND NOT EXISTS (SELECT 1 FROM history_deletions h WHERE h.case_uuid=cases.uuid)",
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
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' data: blob:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; worker-src 'self' blob:",
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
