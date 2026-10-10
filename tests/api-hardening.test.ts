import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { build } from "esbuild";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { ReadableStream as NodeReadableStream } from "node:stream/web";
import { Buffer } from "node:buffer";
import { pbkdf2Sync } from "node:crypto";
import {
  Miniflare,
  convertV4MiniflareOptions,
  Response as MFResponse,
} from "miniflare";
import { defaultConfig, type TradingConfig } from "../src/core/contracts";
import { maxBodyBytes } from "../src/server/http";

let mf: Miniflare,
  db: D1Database,
  chart: D1Database,
  live: ReturnType<
    Awaited<ReturnType<Miniflare["getDurableObjectNamespace"]>>["get"]
  >;
let cookie = "",
  releaseModels: (() => void) | undefined;
let modelsEntered: (() => void) | undefined,
  modelGate: Promise<void> | undefined;
const origin = "https://api-hardening.test",
  password = "fixture-only-password";
const schema = {
  table: "candles",
  market: "symbol",
  timeframe: "timeframe",
  timestamp: "timestamp",
  open: "open",
  high: "high",
  low: "low",
  close: "close",
  volume: "volume",
  timestampUnit: "milliseconds",
};
async function call(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  authenticated = true,
  extra: Record<string, string> = {},
) {
  return mf.dispatchFetch(origin + "/api/v1" + path, {
    method,
    headers: {
      ...(authenticated ? { Cookie: cookie } : {}),
      ...(body !== undefined
        ? { Origin: origin, "Content-Type": "application/json" }
        : {}),
      ...extra,
    },
    ...(body !== undefined
      ? { body: typeof body === "string" ? body : JSON.stringify(body) }
      : {}),
  });
}
async function config(
  config: TradingConfig = defaultConfig,
  extra: Record<string, unknown> = {},
) {
  return call("/admin/config", { config, activation: "NEXT CASE", ...extra });
}
async function activeConfig() {
  return (await (await call("/admin/config")).json()) as {
    id: string;
    config: TradingConfig;
  };
}
async function queuedCase(key = crypto.randomUUID()) {
  const response = await call("/admin/emergency", {
    focus: "NONE",
    sendDiscord: false,
    idempotencyKey: key,
  });
  expect(response.status).toBe(202);
  await live.fetch("https://internal/__test/pause");
  return (await response.json()) as {
    id: string;
    uuid: string;
    status: string;
  };
}
beforeAll(async () => {
  await mkdir(".wrangler/api-hardening", { recursive: true });
  await build({
    entryPoints: ["tests/worker-harness.ts"],
    outfile: ".wrangler/api-hardening/worker.mjs",
    bundle: true,
    format: "esm",
    platform: "browser",
    external: ["cloudflare:workers"],
    logLevel: "silent",
  });
  const salt = "0123456789abcdef0123456789abcdef";
  const hash = `pbkdf2-sha256:100000:${salt}:${Buffer.from(pbkdf2Sync(password, Buffer.from(salt, "hex"), 100000, 32, "sha256")).toString("hex")}`;
  mf = new Miniflare(
    convertV4MiniflareOptions({
      name: "api-hardening",
      scriptPath: ".wrangler/api-hardening/worker.mjs",
      modules: true,
      compatibilityDate: "2026-10-01",
      durableObjects: { OFFICE: { className: "Office", useSQLite: true } },
      d1Databases: ["DB", "CHART_DB"],
      bindings: {
        APP_ENV: "test",
        PUBLIC_ORIGIN: origin,
        CHART_SCHEMA: JSON.stringify(schema),
        ADMIN_PASSWORD_HASH: hash,
        OPENROUTER_API_KEY: "fixture-only-key",
      },
      serviceBindings: { ASSETS: async () => new MFResponse("Fixture") },
      outboundService: async (request) => {
        if (request.method !== "GET")
          throw new Error(
            "No paid inference or delivery is allowed in API hardening tests",
          );
        modelsEntered?.();
        if (modelGate) await modelGate;
        return MFResponse.json({ data: [{ id: "fixture-model" }] });
      },
    }),
  );
  db = await mf.getD1Database("DB");
  chart = await mf.getD1Database("CHART_DB");
  for (const file of (await readdir("migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile("migrations/" + file, "utf8"));
  await chart.exec(
    "CREATE TABLE candles(symbol TEXT,timeframe TEXT,timestamp INTEGER,open REAL,high REAL,low REAL,close REAL,volume REAL,PRIMARY KEY(symbol,timeframe,timestamp));",
  );
  for (const [tf, duration] of [
    ["H1", 3600000],
    ["M15", 900000],
    ["M5", 300000],
  ] as const) {
    const latest = Date.now() - duration - 6000;
    await chart.batch(
      Array.from({ length: 300 }, (_, i) => {
        const close = 100 + Math.sin(i / 8) * 8 + i * 0.02;
        return chart
          .prepare("INSERT INTO candles VALUES (?,?,?,?,?,?,?,?)")
          .bind(
            "BTCUSDT",
            tf,
            latest - (299 - i) * duration,
            close - 0.3,
            close + 1,
            close - 1,
            close,
            100 + (i % 7),
          );
      }),
    );
  }
  const ns = await mf.getDurableObjectNamespace("OFFICE");
  live = ns.get(ns.idFromName("BTCUSDT.P"));
  await live.fetch("https://internal/state");
  const login = await call("/auth/login", { password }, "POST", false);
  expect(login.status).toBe(200);
  cookie = login.headers.get("Set-Cookie")!.split(";")[0];
});
beforeEach(async () => {
  releaseModels?.();
  modelGate = undefined;
  modelsEntered = undefined;
  await live.fetch("https://internal/__test/pause");
  await db.batch(
    [
      "signals",
      "ai_character_outputs",
      "risk_runs",
      "boss_decisions",
      "ai_runs",
      "simulation_runs",
      "case_events",
      "cases",
      "login_limits",
      "api_limits",
    ].map((table) => db.prepare(`DELETE FROM ${table}`)),
  );
  expect((await config()).status).toBe(200);
});
afterEach(async () => {
  releaseModels?.();
  await live.fetch("https://internal/__test/pause");
});
afterAll(async () => {
  await mf?.dispose();
});

describe.sequential("Backend/API audit regressions", () => {
  it("rejects unauthenticated routes and unsupported methods before any mutation", async () => {
    for (const path of [
      "/config",
      "/characters",
      "/prompts",
      "/providers",
      "/models",
      "/test-provider",
      "/rollback",
      "/scan",
      "/emergency",
      "/simulation",
      "/cases",
      "/usage",
      "/deliveries",
      "/deliveries/review",
      "/health",
      "/simulation/history",
      "/cases/missing",
    ]) {
      expect(
        (await call("/admin" + path, undefined, "GET", false)).status,
      ).toBe(401);
      expect((await call("/admin" + path, {}, "POST", false)).status).toBe(401);
    }
    const before = await activeConfig();
    const get = await call("/admin/scan", undefined, "GET", true, {
      Origin: "https://evil.test",
    });
    expect(get.status).toBe(405);
    expect(get.headers.get("Allow")).toBe("POST");
    expect(
      (
        await call(
          "/admin/config",
          { config: defaultConfig, activation: "NEXT CASE" },
          "DELETE",
        )
      ).status,
    ).toBe(405);
    expect((await activeConfig()).id).toBe(before.id);
    expect(
      (await db.prepare("SELECT COUNT(*) n FROM cases").first<{ n: number }>())!
        .n,
    ).toBe(0);
    expect(
      (
        await call("/admin/scan", {}, "POST", true, {
          Origin: "https://evil.test",
        })
      ).status,
    ).toBe(403);
  });
  it("limits streamed bytes without Content-Length, including UTF-8 and anonymous login", async () => {
    for (const path of ["/auth/login", "/admin/config"]) {
      const bytes = new TextEncoder().encode(
        JSON.stringify({
          password: "wrong",
          padding: "é".repeat(maxBodyBytes),
        }),
      );
      const body = new NodeReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
      const response = await mf.dispatchFetch(origin + "/api/v1" + path, {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body,
        duplex: "half",
      });
      expect(response.status).toBe(413);
      expect(response.headers.get("Content-Security-Policy")).toContain(
        "frame-ancestors",
      );
      expect(response.headers.get("X-RateLimit-Limit")).toBe("30");
    }
    const response = await call(
      "/auth/login",
      " ".repeat(maxBodyBytes + 1),
      "POST",
      false,
      { "Content-Length": String(maxBodyBytes + 1) },
    );
    expect(response.status).toBe(413);
    const payload = {
      config: defaultConfig,
      activation: "NEXT CASE",
      padding: "",
    };
    payload.padding = "a".repeat(
      maxBodyBytes -
        new TextEncoder().encode(JSON.stringify(payload)).byteLength,
    );
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    expect(bytes.byteLength).toBe(maxBodyBytes);
    const body = new NodeReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 1000));
        controller.enqueue(bytes.slice(1000));
        controller.close();
      },
    });
    expect(
      (
        await mf.dispatchFetch(origin + "/api/v1/admin/config", {
          method: "POST",
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
            Cookie: cookie,
          },
          body,
          duplex: "half",
        })
      ).status,
    ).toBe(200);
  });
  it("returns typed client errors and security headers for invalid JSON roots and media", async () => {
    for (const body of ["{", "null", "[]", '"text"']) {
      const response = await call("/auth/login", body, "POST", false);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { code: string }).code).toMatch(
        /INVALID_(JSON|BODY)/,
      );
      expect(response.headers.get("X-RateLimit-Limit")).toBe("30");
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    }
    expect((await call("/admin/deliveries/review", "null")).status).toBe(400);
    expect(
      (
        await call("/admin/config", "{}", "POST", true, {
          "Content-Type": "text/plain",
        })
      ).status,
    ).toBe(415);
    expect(
      (await call("/auth/login", { password: "wrong" }, "POST", false)).status,
    ).toBe(401);
  });
  it("applies private/public/Admin publication consistently across meeting, case and character history", async () => {
    const c = await queuedCase();
    const text = "Entry 96.78 / SL ninety five / TP 104.08";
    const analysis = {
      vote: "BUY",
      confidence: 75,
      summary: text,
      reasoning: text,
      evidence: [{ code: "PRICE", direction: "BUY", detail: text }],
      risk_flags: [text],
      price_levels: { entry: 96.78, stop_loss: 95.77, take_profit: 104.08 },
    };
    await db.batch([
      db
        .prepare(
          "UPDATE cases SET status='COMPLETED',updated_at=? WHERE uuid=?",
        )
        .bind(Date.now(), c.uuid),
      db
        .prepare("INSERT INTO ai_character_outputs VALUES (?,?,?)")
        .bind(
          c.uuid,
          "risk",
          JSON.stringify({
            id: "risk",
            status: "SUCCESS",
            output: analysis,
            flags: [],
          }),
        ),
    ]);
    for (const path of [
      "/office/meeting",
      `/cases/${c.id}/public`,
      "/characters/risk",
    ]) {
      const response = await call(path, undefined, "GET", false);
      const body = await response.text();
      expect(body).not.toContain("96.78");
      expect(body).not.toContain("104.08");
      expect(body).not.toContain("ninety five");
    }
    const privateMeeting = (await (
      await call("/office/meeting", undefined, "GET", false)
    ).json()) as {
      meeting: {
        prices_private: boolean;
        turns: { analysis: typeof analysis }[];
      };
    };
    expect(privateMeeting.meeting.prices_private).toBe(true);
    expect(privateMeeting.meeting.turns[0].analysis.price_levels).toBeNull();
    expect(
      JSON.stringify(await (await call("/office/meeting")).json()),
    ).toContain("96.78");
    await config({ ...defaultConfig, publicSignals: true });
    expect(
      JSON.stringify(
        await (await call("/office/meeting", undefined, "GET", false)).json(),
      ),
    ).toContain("96.78");
  });
  it("keeps config and old case intact when APPLY NOW hits quota", async () => {
    const c = await queuedCase(),
      before = await activeConfig(),
      key = crypto.randomUUID();
    const versions = (await db
      .prepare("SELECT COUNT(*) n FROM trading_config_versions")
      .first<{ n: number }>())!.n;
    const response = await config(
      {
        ...defaultConfig,
        budgets: { ...defaultConfig.budgets, casesPerDay: 1 },
      },
      {
        activation: "APPLY NOW",
        confirmed: true,
        idempotencyKey: key,
        expectedVersion: before.id,
      },
    );
    expect(response.status).toBe(400);
    expect((await activeConfig()).id).toBe(before.id);
    expect(
      (await db
        .prepare("SELECT status FROM cases WHERE uuid=?")
        .bind(c.uuid)
        .first<{ status: string }>())!.status,
    ).toBe("QUEUED");
    expect(
      (await db
        .prepare("SELECT COUNT(*) n FROM trading_config_versions")
        .first<{ n: number }>())!.n,
    ).toBe(versions);
    expect(
      await db
        .prepare("SELECT key FROM admin_operations WHERE key=?")
        .bind(`config:${key}`)
        .first(),
    ).toBeNull();
  });
  it("rolls back all APPLY NOW writes on chart failure and a failure inside the commit batch", async () => {
    const c = await queuedCase(),
      before = await activeConfig();
    const payload = {
      activation: "APPLY NOW",
      confirmed: true,
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: before.id,
    };
    await chart.exec("ALTER TABLE candles RENAME TO held_candles");
    try {
      expect((await config(defaultConfig, payload)).status).toBe(500);
    } finally {
      await chart.exec("ALTER TABLE held_candles RENAME TO candles");
    }
    expect((await activeConfig()).id).toBe(before.id);
    await db.exec(
      "CREATE TRIGGER fail_config_cancel BEFORE UPDATE OF status ON cases WHEN NEW.status='CONFIG_CHANGED' BEGIN SELECT RAISE(ABORT,'fixture commit failure'); END;",
    );
    try {
      expect((await config(defaultConfig, payload)).status).toBe(500);
    } finally {
      await db.exec("DROP TRIGGER fail_config_cancel");
    }
    expect((await activeConfig()).id).toBe(before.id);
    expect(
      (await db.prepare("SELECT COUNT(*) n FROM cases").first<{ n: number }>())!
        .n,
    ).toBe(1);
    expect(
      (await db
        .prepare("SELECT status FROM cases WHERE uuid=?")
        .bind(c.uuid)
        .first<{ status: string }>())!.status,
    ).toBe("QUEUED");
    expect(
      await db
        .prepare("SELECT key FROM admin_operations WHERE key=?")
        .bind(`config:${payload.idempotencyKey}`)
        .first(),
    ).toBeNull();
    const accepted = await config(defaultConfig, payload);
    expect(accepted.status).toBe(200);
    await live.fetch("https://internal/__test/pause");
    const result = (await accepted.json()) as {
      id: string;
      replacement_case_id: string;
    };
    const repeat = await config(defaultConfig, payload);
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toEqual(result);
    expect(
      (await db.prepare("SELECT COUNT(*) n FROM cases").first<{ n: number }>())!
        .n,
    ).toBe(2);
    expect(
      (await db
        .prepare("SELECT status FROM cases WHERE uuid=?")
        .bind(c.uuid)
        .first<{ status: string }>())!.status,
    ).toBe("CONFIG_CHANGED");
    const changed = await config({ ...defaultConfig, minRR: 2 }, payload);
    expect(changed.status).toBe(409);
  });
  it("rejects concurrent config edits and deduplicates a committed config retry", async () => {
    const before = await activeConfig(),
      idempotencyKey = crypto.randomUUID();
    const payload = { expectedVersion: before.id, idempotencyKey };
    const first = await config(defaultConfig, payload);
    expect(first.status).toBe(200);
    expect(await (await config(defaultConfig, payload)).json()).toEqual(
      await first.json(),
    );
    const stale = await config(
      { ...defaultConfig, minRR: 2 },
      { expectedVersion: before.id, idempotencyKey: crypto.randomUUID() },
    );
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { code: string }).code).toBe(
      "CONFIG_CONFLICT",
    );
  });
  it("reconciles Emergency retries before reading market and refuses changed payloads", async () => {
    const key = crypto.randomUUID(),
      c = await queuedCase(key);
    await chart.exec("ALTER TABLE candles RENAME TO held_candles");
    try {
      const repeat = await call("/admin/emergency", {
        focus: "NONE",
        sendDiscord: false,
        idempotencyKey: key,
      });
      expect(repeat.status).toBe(202);
      expect(((await repeat.json()) as { id: string }).id).toBe(c.id);
      expect(
        (
          await call("/admin/emergency", {
            focus: "BUY",
            sendDiscord: false,
            idempotencyKey: key,
          })
        ).status,
      ).toBe(409);
    } finally {
      await chart.exec("ALTER TABLE held_candles RENAME TO candles");
    }
    expect(
      (await db.prepare("SELECT COUNT(*) n FROM cases").first<{ n: number }>())!
        .n,
    ).toBe(1);
  });
  it("deduplicates Simulation retries and commits history together with the case", async () => {
    const payload = {
      timestamp: Date.now() - 60000,
      configMode: "CURRENT",
      replayMode: "COMPATIBLE",
      idempotencyKey: crypto.randomUUID(),
    };
    const first = await call("/admin/simulation", payload);
    expect(first.status).toBe(202);
    const c = (await first.json()) as { id: string; uuid: string };
    const ns = await mf.getDurableObjectNamespace("OFFICE"),
      sim = ns.get(ns.idFromName("BTCUSDT.P:simulation"));
    await sim.fetch("https://internal/__test/pause");
    await chart.exec("ALTER TABLE candles RENAME TO held_candles");
    try {
      const repeat = await call("/admin/simulation", payload);
      expect(repeat.status).toBe(202);
      expect(((await repeat.json()) as { id: string }).id).toBe(c.id);
      expect(
        (
          await call("/admin/simulation", {
            ...payload,
            timestamp: payload.timestamp - 1,
          })
        ).status,
      ).toBe(409);
    } finally {
      await chart.exec("ALTER TABLE held_candles RENAME TO candles");
      await sim.fetch("https://internal/__test/pause");
    }
    expect(
      await db
        .prepare(
          "SELECT case_uuid,replay_mode,config_mode FROM simulation_runs WHERE case_uuid=?",
        )
        .bind(c.uuid)
        .first(),
    ).toEqual({
      case_uuid: c.uuid,
      replay_mode: "COMPATIBLE",
      config_mode: "CURRENT",
    });
    expect(
      (await db
        .prepare("SELECT COUNT(*) n FROM cases WHERE mode='SIMULATION'")
        .first<{ n: number }>())!.n,
    ).toBe(1);
    expect(
      await (await call("/admin/simulation/history")).json(),
    ).toMatchObject([
      { id: c.id, replay_mode: "COMPATIBLE", config_mode: "CURRENT" },
    ]);
  });
  it("sanitizes public state and SSE while retaining Admin diagnostics", async () => {
    await chart.exec("ALTER TABLE candles RENAME TO held_candles");
    try {
      await call("/admin/scan", {});
      const state = (await (
        await call("/office/state", undefined, "GET", false)
      ).json()) as { error: string; observed_at: number };
      expect(state.error).toBe("MARKET_UNAVAILABLE");
      expect(state.observed_at).toBeGreaterThan(0);
      const stream = await call("/office/events", undefined, "GET", false),
        reader = stream.body!.getReader();
      const frame = new TextDecoder().decode((await reader.read()).value);
      await reader.cancel();
      expect(frame).toContain("MARKET_UNAVAILABLE");
      expect(frame).not.toMatch(/D1_ERROR|SQLITE|candles/);
      expect(
        JSON.stringify(await (await call("/admin/health")).json()),
      ).toContain("no such table");
    } finally {
      await chart.exec("ALTER TABLE held_candles RENAME TO candles");
    }
  });
  it("keeps public state and config mutations available while provider discovery waits", async () => {
    const entered = new Promise<void>((resolve) => {
      modelsEntered = resolve;
    });
    modelGate = new Promise<void>((resolve) => {
      releaseModels = resolve;
    });
    const diagnostic = call("/admin/test-provider", { id: "openrouter" });
    await entered;
    try {
      expect(
        (await call("/office/state", undefined, "GET", false)).status,
      ).toBe(200);
      expect((await config({ ...defaultConfig, minRR: 2 })).status).toBe(200);
    } finally {
      releaseModels?.();
      modelGate = undefined;
    }
    expect((await diagnostic).status).toBe(200);
  });
  it("validates pagination and respects datetime cutoffs and WIB date-only end-of-day", async () => {
    await config({ ...defaultConfig, publicSignals: true });
    const c = await queuedCase();
    const createdAt = Date.now();
    const signal = {
      signal_id: "SIG-filter",
      case_id: c.id,
      direction: "BUY",
      confidence: 75,
      created_at: createdAt,
      flags: [],
    };
    await db
      .prepare("INSERT INTO signals VALUES (?,?,?,?,?,?,?)")
      .bind(
        crypto.randomUUID(),
        signal.signal_id,
        c.uuid,
        "BUY",
        75,
        createdAt,
        JSON.stringify(signal),
      )
      .run();
    for (const page of ["1.1", "0", "10001", "abc", "Infinity"])
      expect((await call(`/signals?page=${page}`)).status).toBe(400);
    const cutoff = new Date(createdAt - 60000).toISOString();
    expect(
      (
        (await (
          await call(`/signals?to=${encodeURIComponent(cutoff)}`)
        ).json()) as { total: number }
      ).total,
    ).toBe(0);
    const day = new Date(createdAt + 7 * 3600000).toISOString().slice(0, 10);
    expect(
      (
        (await (await call(`/signals?from=${day}&to=${day}`)).json()) as {
          total: number;
        }
      ).total,
    ).toBe(1);
    expect((await call(`/signals?from=2026-12-31&to=2026-01-01`)).status).toBe(
      400,
    );
    expect((await call(`/signals?to=not-a-date`)).status).toBe(400);
    expect((await call(`/signals?to=2026-02-31`)).status).toBe(400);
  });
});
