import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { readFile, mkdir, readdir } from "node:fs/promises";
import { pbkdf2Sync } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  Miniflare,
  convertV4MiniflareOptions,
  Response as MFResponse,
} from "miniflare";
import { digest } from "../src/server/auth";
import { apiLimits } from "../src/server/rate-limit";
import {
  characterIds,
  defaultConfig,
  workersAIModel,
  type CharacterConfig,
  type Signal,
} from "../src/core/contracts";
let mf: Miniflare,
  cookie = "";
let scenario: "BUY" | "SELL" | "NO_TRADE" | "TIE" | "BOSS_REVERSE" = "BUY";
let failure: "none" | "primary" | "all" = "none";
let release: (() => void) | undefined;
let gate: Promise<void> | undefined;
let requests = 0;
let aiRequests = 0;
let discordStatus: number | "timeout" = 204;
const discordMessages: {
  content: string;
  allowed_mentions: { parse: string[] };
}[] = [];
const origin = "https://byga.test";
const password = "fixture-only-admin-password";
const salt = "0123456789abcdef0123456789abcdef";
const encoded = `pbkdf2-sha256:100000:${salt}:${Buffer.from(pbkdf2Sync(password, Buffer.from(salt, "hex"), 100000, 32, "sha256")).toString("hex")}`;
const chart = {
  table: "candles",
  market: "symbol",
  timeframe: "timeframe",
  timestamp: "open_time",
  closed: "is_closed",
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
  authenticated = true,
  customOrigin = origin,
) {
  return mf.dispatchFetch(origin + "/api/v1" + path, {
    method: body ? "POST" : "GET",
    headers: {
      ...(authenticated && cookie ? { Cookie: cookie } : {}),
      ...(body
        ? { "Content-Type": "application/json", Origin: customOrigin }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function done(id: string) {
  for (let i = 0; i < 300; i++) {
    const res = await call(`/admin/cases/${id}`);
    const c = (await res.json()) as {
      status: string;
      result: {
        signal?: Signal;
        analysts?: { flags: string[]; status: string }[];
        vote?: { flags: string[] };
        boss?: { flags: string[] };
      };
      context: unknown;
    };
    if (["COMPLETED", "NO_CONSENSUS", "FAILED"].includes(c.status)) return c;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error(`Case did not finish: ${id}`);
}
beforeAll(async () => {
  await mkdir(".wrangler/test", { recursive: true });
  await build({
    entryPoints: ["tests/worker-harness.ts"],
    outfile: ".wrangler/test/worker.mjs",
    bundle: true,
    format: "esm",
    platform: "browser",
    external: ["cloudflare:workers"],
    logLevel: "silent",
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      name: "test-office",
      scriptPath: ".wrangler/test/worker.mjs",
      modules: true,
      compatibilityDate: "2026-10-01",
      durableObjects: { OFFICE: { className: "Office", useSQLite: true } },
      d1Databases: ["DB", "CHART_DB"],
      bindings: {
        APP_ENV: "test",
        PUBLIC_ORIGIN: origin,
        CHART_SCHEMA: JSON.stringify(chart),
        ADMIN_PASSWORD_HASH: encoded,
        OPENAI_API_KEY: "fixture-only-ai-key",
        OPENROUTER_API_KEY: "fixture-only-openrouter",
        GEMINI_API_KEY: "fixture-only-gemini",
        DISCORD_MEETING_WEBHOOK:
          "https://discord.invalid/webhooks/meeting",
        DISCORD_SIGNAL_WEBHOOK:
          "https://discord.invalid/webhooks/signal",
      },
      serviceBindings: {
        ASSETS: async () => new MFResponse("<html><body>BYGA</body></html>"),
      },
      outboundService: async (request) => {
        requests++;
        const u = new URL(request.url);
        if (u.hostname === "discord.invalid") {
          if (discordStatus === "timeout")
            throw new Error("Fixture network interruption");
          discordMessages.push(
            (await request.json()) as {
              content: string;
              allowed_mentions: { parse: string[] };
            },
          );
          return new MFResponse(null, {
            status: discordStatus,
            headers: discordStatus === 429 ? { "Retry-After": "120" } : {},
          });
        }
        if (u.pathname.endsWith("/models"))
          return MFResponse.json({ data: [{ id: "fixture" }] });
        aiRequests++;
        if (gate) await gate;
        if (
          failure === "all" ||
          (failure === "primary" && u.hostname === "openrouter.ai")
        )
          return new MFResponse("Fixture outage", { status: 503 });
        const body = (await request.json()) as {
          messages?: { content: string }[];
          contents?: { parts: { text: string }[] }[];
        };
        const prompt =
          body.messages?.[0]?.content ??
          body.contents?.[0]?.parts[0].text ??
          "";
        const vote =
          scenario === "TIE"
            ? /^(Liquidity|Volume|Quant|Market Positioning) Analyst/.test(prompt)
              ? "SELL"
              : "BUY"
            : scenario === "BOSS_REVERSE"
              ? prompt.startsWith("Head Trader")
                ? "SELL"
                : "BUY"
              : scenario;
        const output = {
          vote,
          confidence: 75,
          summary: "Fixture structured analysis",
          reasoning: "Deterministic test evidence",
          evidence: [
            {
              code: "DIRECTIONAL_BIAS",
              direction: vote === "NO_TRADE" ? "NONE" : vote,
              detail: "Fixture",
            },
          ],
          risk_flags: [],
        };
        return MFResponse.json(
          u.hostname.includes("googleapis")
            ? {
                candidates: [
                  { content: { parts: [{ text: JSON.stringify(output) }] } },
                ],
                usageMetadata: { totalTokenCount: 64 },
              }
            : {
                choices: [{ message: { content: JSON.stringify(output) } }],
                usage: { total_tokens: 64 },
              },
        );
      },
    }),
  );
  const db = await mf.getD1Database("DB");
  for (const file of (await readdir("migrations"))
    .filter((p) => p.endsWith(".sql"))
    .sort())
    await db.exec(await readFile("migrations/" + file, "utf8"));
  const market = await mf.getD1Database("CHART_DB");
  await market.exec(
    "CREATE TABLE candles(symbol TEXT,timeframe TEXT,open_time INTEGER,open REAL,high REAL,low REAL,close REAL,volume REAL,is_closed INTEGER NOT NULL CHECK(is_closed IN (0,1)),PRIMARY KEY(symbol,timeframe,open_time));",
  );
  await market.exec(
    "CREATE TABLE derivative_metrics(symbol TEXT NOT NULL,metric TEXT NOT NULL,timeframe TEXT NOT NULL DEFAULT '',ts INTEGER NOT NULL,value REAL NOT NULL,value2 REAL,value3 REAL,source TEXT NOT NULL,PRIMARY KEY(symbol,metric,timeframe,ts));",
  );
  const now = Date.now();
  for (const [tf, duration] of [
    ["H1", 3600000],
    ["M15", 900000],
    ["M5", 300000],
  ] as const) {
    const latest =
      Math.floor((now - duration - 5000) / duration) * duration + 2 * duration;
    const statements = Array.from({ length: 320 }, (_, i) => {
      const close = 100 + Math.sin(i / 8) * 8 + i * 0.02;
      return market
        .prepare("INSERT INTO candles VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(
          "BTCUSDT",
          tf,
          latest - (319 - i) * duration,
          close - 0.3,
          close + 1,
          close - 1,
          close,
          100 + (i % 7),
          1,
        );
    });
    await market.batch(statements);
  }
  const derivativeBase =
    Math.floor((now - 300000 - 5000) / 300000) * 300000;
  const derivativeRows = [];
  for (let i = 0; i < 13; i++) {
    const ts = derivativeBase - (12 - i) * 300000;
    derivativeRows.push(
      market
        .prepare("INSERT INTO derivative_metrics VALUES (?,?,?,?,?,?,?,?)")
        .bind(
          "BTCUSDT",
          "open_interest",
          "M5",
          ts,
          1_000_000_000,
          null,
          null,
          "fixture",
        ),
      market
        .prepare("INSERT INTO derivative_metrics VALUES (?,?,?,?,?,?,?,?)")
        .bind(
          "BTCUSDT",
          "long_short_ratio",
          "M5",
          ts,
          1,
          0.5,
          0.5,
          "fixture",
        ),
    );
  }
  derivativeRows.push(
    market
      .prepare("INSERT INTO derivative_metrics VALUES (?,?,?,?,?,?,?,?)")
      .bind(
        "BTCUSDT",
        "funding_rate",
        "",
        derivativeBase - 3600000,
        0,
        null,
        null,
        "fixture",
      ),
    market
      .prepare("INSERT INTO derivative_metrics VALUES (?,?,?,?,?,?,?,?)")
      .bind(
        "BTCUSDT",
        "liquidation",
        "M5",
        derivativeBase,
        120000,
        60000,
        60000,
        "fixture",
      ),
  );
  await market.batch(derivativeRows);
}, 60000);
beforeEach(async () => {
  await (await mf.getD1Database("DB")).exec("DELETE FROM api_limits");
});
afterAll(async () => {
  await mf?.dispose();
});
describe.sequential("Real Worker / D1 / Durable Object workflow", () => {
  it("atomically limits concurrent API requests, isolates IPs and resets expired windows", async () => {
    const db = await mf.getD1Database("DB");
    const ip = "198.51.100.8";
    const key = `read:${await digest(ip)}`;
    await db
      .prepare("INSERT INTO api_limits VALUES (?,?,?)")
      .bind(key, apiLimits.read - 1, Date.now() + apiLimits.windowMs)
      .run();
    const request = (headers: Record<string, string> = {}) =>
      mf.dispatchFetch(origin + "/api/v1/auth/session", {
        headers: { "CF-Connecting-IP": ip, ...headers },
      });
    const responses = await Promise.all([request(), request(), request()]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 429, 429]);
    const blocked = responses.find((r) => r.status === 429)!;
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(blocked.headers.get("Cache-Control")).toBe("no-store");
    expect(blocked.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect((await request({ "X-Forwarded-For": "198.51.100.99" })).status).toBe(
      429,
    );
    expect((await request({ "CF-Connecting-IP": "198.51.100.9" })).status).toBe(
      200,
    );
    await db
      .prepare("UPDATE api_limits SET reset_at=0 WHERE key=?")
      .bind(key)
      .run();
    const reset = await request();
    expect(reset.status).toBe(200);
    expect(reset.headers.get("X-RateLimit-Remaining")).toBe(
      String(apiLimits.read - 1),
    );
    expect(
      (await db.prepare("SELECT key FROM api_limits").all()).results.every(
        (r) => !String(r.key).includes(ip),
      ),
    ).toBe(true);
  });
  it("separates mutation budgets from reads and protects rejected Admin mutations", async () => {
    const db = await mf.getD1Database("DB");
    const ip = "198.51.100.10";
    const key = `write:${await digest(ip)}`;
    await db
      .prepare("INSERT INTO api_limits VALUES (?,?,?)")
      .bind(key, apiLimits.write - 1, Date.now() + apiLimits.windowMs)
      .run();
    const responses = await Promise.all(
      Array.from({ length: 3 }, () =>
        mf.dispatchFetch(origin + "/api/v1/admin/emergency", {
          method: "POST",
          headers: { "CF-Connecting-IP": ip, Origin: origin },
          body: "{}",
        }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([401, 429, 429]);
    expect(
      (
        await mf.dispatchFetch(origin + "/api/v1/auth/session", {
          headers: { "CF-Connecting-IP": ip },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await mf.dispatchFetch(origin + "/office", {
          headers: { "CF-Connecting-IP": ip },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await mf.dispatchFetch(origin + "/api/v1/auth/session", {
          method: "OPTIONS",
          headers: { "CF-Connecting-IP": ip },
        })
      ).status,
    ).toBe(204);
  });
  it("rejects a gap caused by the real is_closed flag without writing market data", async () => {
    const chartDb = await mf.getD1Database("CHART_DB");
    const row = await chartDb
      .prepare(
        "SELECT MAX(open_time) AS t FROM candles WHERE timeframe='M5' AND open_time<=?",
      )
      .bind(Date.now() - 305000)
      .first<{ t: number }>();
    await chartDb
      .prepare(
        "UPDATE candles SET is_closed=0 WHERE timeframe='M5' AND open_time=?",
      )
      .bind(row!.t)
      .run();
    const before = await chartDb
      .prepare("SELECT * FROM candles ORDER BY timeframe,open_time")
      .all();
    try {
      const response = await call("/market/status");
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error:
          "Market data unavailable; check chart_db binding and candle schema",
      });
      expect(
        (
          await chartDb
            .prepare("SELECT * FROM candles ORDER BY timeframe,open_time")
            .all()
        ).results,
      ).toEqual(before.results);
    } finally {
      await chartDb
        .prepare(
          "UPDATE candles SET is_closed=1 WHERE timeframe='M5' AND open_time=?",
        )
        .bind(row!.t)
        .run();
    }
  });
  it("rejects unauthorized Admin and private signals", async () => {
    expect((await call("/admin/config", undefined, false)).status).toBe(401);
    expect((await call("/signals", undefined, false)).status).toBe(401);
  });
  it("publishes only sanitized character appearance presets", async () => {
    const response = await call("/characters", undefined, false);
    expect(response.status).toBe(200);
    const appearances = (await response.json()) as {
      id: string;
      avatar: string;
      primary_provider?: string;
    }[];
    expect(appearances).toHaveLength(10);
    expect(appearances.map((entry) => entry.id)).toEqual([...characterIds]);
    expect(appearances[0]).toEqual({
      id: expect.any(String),
      avatar: "professional",
    });
    expect(appearances.every((entry) => !entry.primary_provider)).toBe(true);
  });
  it("streams office state over SSE with no-cache event framing", async () => {
    const response = await mf.dispatchFetch(origin + "/api/v1/office/events", {
      headers: { "CF-Connecting-IP": "198.51.100.42" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe(
      "no-cache, no-transform",
    );
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toMatch(
      /^event: office\ndata: \{.*"office":.*\}\n\n$/,
    );
    await reader.cancel();
  });
  it("login requires same origin and verifies hash, creates Secure session", async () => {
    expect(
      (await call("/auth/login", { password }, false, "https://evil.test"))
        .status,
    ).toBe(403);
    expect(
      (await call("/auth/login", { password: "wrong" }, false)).status,
    ).toBe(401);
    const res = await call("/auth/login", { password }, false);
    expect(res.status).toBe(200);
    const set = res.headers.get("Set-Cookie")!;
    expect(set).toContain("HttpOnly");
    expect(set).toContain("Secure");
    expect(set).toContain("SameSite=Strict");
    cookie = set.split(";")[0];
    expect(await (await call("/auth/session")).json()).toEqual({ admin: true });
  });
  it("accepts Workers AI character settings and reports missing binding without real inference", async () => {
    const health = (await (await call("/admin/health")).json()) as {
      configured: { id: string; configured: boolean }[];
    };
    expect(health.configured).toContainEqual({
      id: "workers-ai",
      configured: false,
    });
    const characters = (await (
      await call("/admin/characters")
    ).json()) as CharacterConfig[];
    const original = characters.find((c) => c.id === "trend")!;
    const updated = await call("/admin/characters", {
      ...original,
      primary_provider: "workers-ai",
      primary_model: workersAIModel,
    });
    expect(updated.status).toBe(200);
    const saved = (await (
      await call("/admin/characters")
    ).json()) as CharacterConfig[];
    expect(saved.find((c) => c.id === "trend")).toMatchObject({
      primary_provider: "workers-ai",
      primary_model: workersAIModel,
    });
    expect((await call("/admin/models", { id: "workers-ai" })).status).toBe(
      503,
    );
    expect(
      (await call("/admin/test-provider", { id: "workers-ai" })).status,
    ).toBe(503);
    await call("/admin/characters", original);
  });
  it("reads only closed H1/M15/M5 candles and rejects cross-origin mutation", async () => {
    const res = await call("/market/status");
    expect(res.status).toBe(200);
    const m = (await res.json()) as {
      timeframes: Record<string, { timestamp: number }[]>;
    };
    expect(Object.keys(m.timeframes)).toEqual(["H1", "M15", "M5"]);
    expect(m.timeframes.M5.at(-1)!.timestamp + 300000).toBeLessThan(Date.now());
    expect(
      (await call("/admin/scan", {}, true, "https://evil.test")).status,
    ).toBe(403);
  });
  it("immutable NEXT CASE config versions and required APPLY NOW confirmation", async () => {
    const res = await call("/admin/config", {
      config: { ...defaultConfig, publicSignals: true },
      activation: "NEXT CASE",
    });
    expect(res.status).toBe(200);
    expect(
      (
        await call("/admin/config", {
          config: defaultConfig,
          activation: "APPLY NOW",
        })
      ).status,
    ).toBe(409);
    const db = await mf.getD1Database("DB");
    await expect(
      db
        .prepare(
          "UPDATE trading_config_versions SET snapshot=? WHERE version=1",
        )
        .bind("{}")
        .run(),
    ).rejects.toThrow("immutable config");
  });
  it("persists Admin four-group minimum and rejects invalid values", async () => {
    const config = {
      ...defaultConfig,
      publicSignals: true,
      scannerConsensusMin: 3,
    };
    const saved = await call("/admin/config", {
      config,
      activation: "NEXT CASE",
    });
    expect(saved.status).toBe(200);
    const version = (await saved.json()) as { id: string };
    expect(await (await call("/admin/config")).json()).toMatchObject({
      id: version.id,
      config: { scannerConsensusMin: 3 },
    });
    expect(await (await call("/office/state")).json()).toMatchObject({
      scanner_consensus_min: 3,
      group_consensus_min: 3,
      group_names: [
        "SMC_ICT",
        "INDICATORS",
        "VOLUME",
        "DERIVATIVES_POSITIONING",
      ],
    });
    for (const minimum of [0, 5, 2.5]) {
      expect(
        (
          await call("/admin/config", {
            config: { ...config, scannerConsensusMin: minimum },
            activation: "NEXT CASE",
          })
        ).status,
      ).toBe(400);
    }
    expect((await call("/admin/scan", {})).status).toBe(200);
    const state = (await (await call("/office/state")).json()) as {
      scanners: { direction: string }[];
      groups: { group: string; direction: string }[];
    };
    expect(state.scanners).toHaveLength(6);
    expect(state.groups).toHaveLength(4);
    expect(state.groups.map((group) => group.group).sort()).toEqual([
      "DERIVATIVES_POSITIONING",
      "INDICATORS",
      "SMC_ICT",
      "VOLUME",
    ]);
    await call("/admin/config", {
      config: { ...defaultConfig, publicSignals: true },
      activation: "NEXT CASE",
    });
  });
  it("emergency BUY pipeline persists analysts/risk/boss/signal and deduplicates retry", async () => {
    scenario = "BUY";
    const body = {
      focus: "NONE",
      sendDiscord: false,
      idempotencyKey: "integration-buy",
    };
    const r = await call("/admin/emergency", body);
    expect(r.status, await r.clone().text()).toBe(202);
    const item = (await r.json()) as { id: string; uuid: string };
    const repeat = (await (await call("/admin/emergency", body)).json()) as {
      id: string;
    };
    expect(repeat.id).toBe(item.id);
    const c = await done(item.id);
    expect(c.status, JSON.stringify(c.result)).toBe("COMPLETED");
    expect(c.result.signal?.direction).toBe("BUY");
    expect(c.result.signal?.market).toBe("BTCUSDT.P");
    expect(c.result.signal?.group_composition).toBeTruthy();
    expect(c.result.signal?.flags).toContain("EMERGENCY");
    const db = await mf.getD1Database("DB");
    expect(
      (await db
        .prepare("SELECT COUNT(*) AS n FROM signals WHERE case_uuid=?")
        .bind(item.uuid)
        .first<{ n: number }>())!.n,
    ).toBe(1);
    expect(
      (await db
        .prepare(
          "SELECT COUNT(*) AS n FROM ai_character_outputs WHERE case_uuid=?",
        )
        .bind(item.uuid)
        .first<{ n: number }>())!.n,
    ).toBe(10);
    const publicRes = await call(`/cases/${item.id}/public`, undefined, false);
    const text = await publicRes.text();
    expect(text).not.toContain("fixture-only-ai-key");
    expect(text).not.toContain("fixture-only-openrouter");
    expect(text).not.toContain("primary_provider");
    expect(text).not.toContain("rendered_prompt");
    expect(text).not.toContain('"provider"');
    expect(text).not.toContain('"model"');
    const callsBeforeMeeting = requests;
    const meetingResponse = await call("/office/meeting", undefined, false);
    expect(meetingResponse.status).toBe(200);
    const meetingText = await meetingResponse.text();
    const meeting = JSON.parse(meetingText).meeting;
    expect(meeting.case_id).toBe(item.id);
    expect(meeting.finished).toBe(true);
    expect(
      meeting.turns.map((turn: { character: string }) => turn.character),
    ).toEqual([
      "trend",
      "structure",
      "momentum",
      "liquidity",
      "volume",
      "quant",
      "derivatives",
      "positioning",
      "risk",
      "boss",
    ]);
    expect(meeting.turns.at(-1).analysis.summary).toBe(
      c.result.signal?.boss_summary,
    );
    for (const privateField of [
      '"provider"',
      '"model"',
      "rendered_prompt",
      "fixture-only",
      '"context"',
    ])
      expect(meetingText).not.toContain(privateField);
    expect(requests).toBe(callsBeforeMeeting);
    const publicHistory = await call("/characters/trend", undefined, false);
    const publicText = await publicHistory.text();
    expect(publicText).not.toContain('"provider"');
    expect(publicText).not.toContain('"model"');
    expect(publicText).not.toContain('"validationErrors"');
    const adminHistory = await call("/characters/trend");
    const entries = (await adminHistory.json()) as {
      provider?: string;
      model?: string;
    }[];
    expect(entries[0].provider).toBe("openrouter");
    expect(entries[0].model).toBeTruthy();
  }, 30000);
  it("emergency SELL uses same tested pipeline and live signal contracts", async () => {
    scenario = "SELL";
    const item = (await (
      await call("/admin/emergency", {
        focus: "BUY",
        sendDiscord: false,
        idempotencyKey: "integration-sell",
      })
    ).json()) as { id: string };
    const c = await done(item.id);
    expect(c.status, JSON.stringify(c.result)).toBe("COMPLETED");
    expect(c.result.signal?.direction).toBe("SELL");
    expect(c.result.signal!.stop_loss).toBeGreaterThan(
      c.result.signal!.entry_high,
    );
  }, 30000);
  it("does not let stale simulation mode strand live recovery work", async () => {
    const db = await mf.getD1Database("DB");
    const template = await db
      .prepare(
        "SELECT * FROM cases WHERE mode='LIVE' AND source='EMERGENCY' AND status='COMPLETED' AND result IS NOT NULL ORDER BY created_at DESC LIMIT 1",
      )
      .first<{
        candle_timestamp: number;
        config_version: string;
        context: string;
        result: string;
      }>();
    expect(template).toBeTruthy();
    const uuid = crypto.randomUUID();
    const id = "CASE-LIVE-PRIORITY-RECOVERY";
    const now = Date.now();
    await db
      .prepare("INSERT INTO cases VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(
        uuid,
        id,
        "LIVE",
        "EMERGENCY",
        "BUY",
        "SIGNAL_CREATED",
        template!.candle_timestamp,
        template!.config_version,
        template!.context,
        template!.result,
        now,
        now,
        "live-priority-recovery-fixture",
      )
      .run();
    const ns = await mf.getDurableObjectNamespace("OFFICE");
    const stub = ns.get(ns.idFromName("BTCUSDT.P"));
    const legacy = await stub.fetch("https://test/__test/mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "SIMULATION" }),
    });
    expect(legacy.status).toBe(200);
    await stub.fetch("https://test/__test/alarm");
    expect(
      (
        await db
          .prepare("SELECT status FROM cases WHERE uuid=?")
          .bind(uuid)
          .first<{ status: string }>()
      )!.status,
    ).toBe("COMPLETED");
  });

  it("simulation writes result only to simulation history, never live signals", async () => {
    scenario = "BUY";
    const db = await mf.getD1Database("DB");
    const before = (await db
      .prepare("SELECT COUNT(*) AS n FROM signals")
      .first<{ n: number }>())!.n;
    const item = (await (
      await call("/admin/simulation", {
        timestamp: Date.now() - 600000,
        configMode: "CURRENT",
        replayMode: "COMPATIBLE",
        idempotencyKey: "integration-sim",
      })
    ).json()) as { id: string };
    expect(item.id).toMatch(/^CASE-/);
    const c = await done(item.id);
    expect(c.status, JSON.stringify(c.result)).toBe("COMPLETED");
    const liveMeeting = (await (
      await call("/office/meeting", undefined, false)
    ).json()) as { meeting: { case_id: string } | null };
    expect(liveMeeting.meeting?.case_id).not.toBe(item.id);
    expect(
      (await db
        .prepare("SELECT COUNT(*) AS n FROM signals")
        .first<{ n: number }>())!.n,
    ).toBe(before);
    expect(
      (await db
        .prepare("SELECT COUNT(*) AS n FROM simulation_runs")
        .first<{ n: number }>())!.n,
    ).toBe(1);
  }, 30000);
  it("STRICT replay pins historical identities and does not use another model when unavailable", async () => {
    const db = await mf.getD1Database("DB");
    const historical = await db
      .prepare(
        "SELECT id FROM cases WHERE mode='LIVE' AND status='COMPLETED' ORDER BY created_at LIMIT 1",
      )
      .first<{ id: string }>();
    const body = {
      timestamp: Date.now() - 600000,
      configMode: "CURRENT",
      replayMode: "STRICT",
      historicalCaseId: historical!.id,
      idempotencyKey: "strict-replay-success",
    };
    scenario = "BUY";
    const row = (await (await call("/admin/simulation", body)).json()) as {
      id: string;
    };
    expect((await done(row.id)).status).toBe("COMPLETED");
    failure = "primary";
    const failed = (await (
      await call("/admin/simulation", {
        ...body,
        idempotencyKey: "strict-replay-unavailable",
      })
    ).json()) as { id: string };
    const result = await done(failed.id);
    expect(result.status).toBe("FAILED");
    expect(JSON.stringify(result.result)).toContain("STRICT replay failed");
    failure = "none";
  }, 20000);
  it("market repository remains unchanged; usage/audit stored and no secret leaks", async () => {
    const market = await mf.getD1Database("CHART_DB");
    expect(
      (await market
        .prepare("SELECT COUNT(*) AS n FROM candles")
        .first<{ n: number }>())!.n,
    ).toBe(960);
    const db = await mf.getD1Database("DB");
    const usage = await call("/admin/usage");
    expect(
      ((await usage.json()) as { calls: number }).calls,
    ).toBeGreaterThanOrEqual(24);
    expect(requests).toBeGreaterThanOrEqual(24);
    const audits = await db
      .prepare("SELECT raw,rendered_prompt FROM ai_runs")
      .all();
    expect(JSON.stringify(audits.results)).not.toContain("fixture-only-ai-key");
  });
  it("all NO_TRADE is scanner fallback; AI tie is resolved by Boss", async () => {
    scenario = "NO_TRADE";
    let item = (await (
      await call("/admin/emergency", {
        focus: "NONE",
        sendDiscord: false,
        idempotencyKey: "all-abstain",
      })
    ).json()) as { id: string };
    let c = await done(item.id);
    expect(c.result.vote?.flags).toContain("SCANNER_FALLBACK");
    expect(["COMPLETED", "NO_CONSENSUS"]).toContain(c.status);
    scenario = "TIE";
    item = (await (
      await call("/admin/emergency", {
        focus: "NONE",
        sendDiscord: false,
        idempotencyKey: "ai-tie-fixture",
      })
    ).json()) as { id: string };
    c = await done(item.id);
    expect(c.status, JSON.stringify(c.result)).toBe("COMPLETED");
    expect(c.result.signal?.direction).toBe("BUY");
  }, 30000);
  it("Boss cannot reverse normal majority, even after persistent invalid output", async () => {
    scenario = "BOSS_REVERSE";
    const item = (await (
      await call("/admin/emergency", {
        focus: "NONE",
        sendDiscord: false,
        idempotencyKey: "boss-authority",
      })
    ).json()) as { id: string };
    const c = await done(item.id);
    expect(c.result.signal?.direction).toBe("BUY");
    expect(c.result.boss?.flags).toContain("SEMANTIC_VALIDATION_FAILED");
    scenario = "BUY";
  }, 30000);
  it("primary outage uses fallback; full outage records AI_DEGRADED without inventing votes", async () => {
    failure = "primary";
    let item = (await (
      await call("/admin/emergency", {
        focus: "NONE",
        sendDiscord: false,
        idempotencyKey: "primary-outage",
      })
    ).json()) as { id: string };
    let c = await done(item.id);
    expect(c.status, JSON.stringify(c.result)).toBe("COMPLETED");
    expect(
      c.result.analysts?.every((a) => a.flags.includes("MODEL_FALLBACK_USED")),
    ).toBe(true);
    failure = "all";
    item = (await (
      await call("/admin/emergency", {
        focus: "NONE",
        sendDiscord: false,
        idempotencyKey: "full-outage",
      })
    ).json()) as { id: string };
    c = await done(item.id);
    expect(c.result.vote?.flags).toContain("AI_DEGRADED");
    expect(c.result.analysts?.every((a) => a.status === "UNAVAILABLE")).toBe(
      true,
    );
    failure = "none";
    await call("/admin/test-provider", { id: "openrouter" });
    await call("/admin/test-provider", { id: "gemini" });
  }, 30000);
  it("APPLY NOW cancels in-flight case and replacement owns the new config", async () => {
    failure = "none";
    await call("/admin/test-provider", { id: "openrouter" });
    await call("/admin/test-provider", { id: "gemini" });
    gate = new Promise<void>((r) => {
      release = r;
    });
    const item = (await (
      await call("/admin/emergency", {
        focus: "NONE",
        sendDiscord: false,
        idempotencyKey: "cancel-in-flight",
      })
    ).json()) as { id: string };
    let reachedAnalysis = false;
    for (let i = 0; i < 100; i++) {
      const row = (await (await call("/admin/cases/" + item.id)).json()) as {
        status: string;
      };
      if (row.status === "AI_ANALYSIS") {
        reachedAnalysis = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(reachedAnalysis).toBe(true);
    const updated = await call("/admin/config", {
      config: { ...defaultConfig, publicSignals: true, minRR: 2 },
      activation: "APPLY NOW",
      confirmed: true,
    });
    expect(updated.status).toBe(200);
    const version = (await updated.json()) as { id: string };
    gate = undefined;
    release?.();
    const cancelled = (await (
      await call("/admin/cases/" + item.id)
    ).json()) as { status: string; uuid: string };
    expect(cancelled.status).toBe("CONFIG_CHANGED");
    const db = await mf.getD1Database("DB");
    expect(
      (await db
        .prepare("SELECT COUNT(*) AS n FROM signals WHERE case_uuid=?")
        .bind(cancelled.uuid)
        .first<{ n: number }>())!.n,
    ).toBe(0);
    const replacement = await db
      .prepare("SELECT id,config_version FROM cases WHERE config_version=?")
      .bind(version.id)
      .first<{ id: string; config_version: string }>();
    expect(replacement!.id).not.toBe(item.id);
    expect((await done(replacement!.id)).status).toBe("COMPLETED");
  }, 30000);
  it("duplicate M5 scan request reuses persisted scanner run and does not reprocess candle", async () => {
    await call("/admin/scan", {});
    const db = await mf.getD1Database("DB");
    const before = (await db
      .prepare("SELECT COUNT(*) AS n FROM scanner_runs")
      .first<{ n: number }>())!.n;
    await call("/admin/scan", {});
    expect(
      (await db
        .prepare("SELECT COUNT(*) AS n FROM scanner_runs")
        .first<{ n: number }>())!.n,
    ).toBe(before);
  });
  it("queued AUTO case is revalidated; stale setup avoids AI calls", async () => {
    const blocked = {
      ...defaultConfig,
      scanner: {
        ...defaultConfig.scanner,
        adxMin: 100,
        volumeRatio: 10,
        momentumRsi: [100, 0] as [number, number],
        reversionRsi: [0, 100] as [number, number],
        displacementAtr: 10,
      },
    };
    await call("/admin/config", { config: blocked, activation: "NEXT CASE" });
    const row = (await (
      await call("/admin/emergency", {
        focus: "NONE",
        sendDiscord: false,
        idempotencyKey: "stale-queue-fixture",
      })
    ).json()) as { id: string; uuid: string };
    const db = await mf.getD1Database("DB");
    await db
      .prepare(
        "UPDATE cases SET source='AUTO',direction='BUY' WHERE uuid=? AND status='QUEUED'",
      )
      .bind(row.uuid)
      .run();
    for (let i = 0; i < 150; i++) {
      const c = (await (await call("/admin/cases/" + row.id)).json()) as {
        status: string;
      };
      if (c.status === "STALE") {
        expect(
          (await db
            .prepare("SELECT COUNT(*) AS n FROM ai_runs WHERE case_uuid=?")
            .bind(row.uuid)
            .first<{ n: number }>())!.n,
        ).toBe(0);
        return;
      }
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error("Queue did not become STALE");
  }, 15000);
  it("queued BUY changing to SELL keeps old ID and creates a new case", async () => {
    const chartDb = await mf.getD1Database("CHART_DB");
    const rows = (
      await chartDb
        .prepare(
          "SELECT timeframe,open_time AS timestamp FROM candles ORDER BY timeframe,open_time",
        )
        .all<{ timeframe: string; timestamp: number }>()
    ).results;
    const index: Record<string, number> = {};
    await chartDb.batch(
      rows.map((row) => {
        const i = (index[row.timeframe] = (index[row.timeframe] ?? 0) + 1);
        const close = 1000 - i;
        return chartDb
          .prepare(
            "UPDATE candles SET open=?,high=?,low=?,close=?,volume=100 WHERE timeframe=? AND open_time=?",
          )
          .bind(
            close + 0.5,
            close + 0.7,
            close - 0.2,
            close,
            row.timeframe,
            row.timestamp,
          );
      }),
    );
    await call("/admin/config", {
      config: {
        ...defaultConfig,
        scanner: { ...defaultConfig.scanner, volumeRatio: 0.1 },
      },
      activation: "NEXT CASE",
    });
    scenario = "SELL";
    const row = (await (
      await call("/admin/emergency", {
        focus: "NONE",
        sendDiscord: false,
        idempotencyKey: "changed-queue-fixture",
      })
    ).json()) as { id: string; uuid: string };
    const db = await mf.getD1Database("DB");
    await db
      .prepare(
        "UPDATE cases SET source='AUTO',direction='BUY' WHERE uuid=? AND status='QUEUED'",
      )
      .bind(row.uuid)
      .run();
    let changed = false;
    for (let i = 0; i < 150; i++) {
      const c = (await (await call("/admin/cases/" + row.id)).json()) as {
        status: string;
        direction: string;
      };
      if (c.status === "DIRECTION_CHANGED") {
        expect(c.direction).toBe("BUY");
        changed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(changed).toBe(true);
    const replacement = await db
      .prepare("SELECT id,direction FROM cases WHERE idempotency_key LIKE ?")
      .bind(`changed:${row.uuid}:%`)
      .first<{ id: string; direction: string }>();
    expect(replacement!.id).not.toBe(row.id);
    expect(replacement!.direction).toBe("SELL");
    expect((await done(replacement!.id)).status).toBe("COMPLETED");
    scenario = "BUY";
  }, 20000);
  it("Discord outbox sends meeting and final signal once, persists result and LOW_RR warning", async () => {
    scenario = "SELL";
    await call("/admin/config", {
      config: { ...defaultConfig, minRR: 10, slAtr: 5, publicSignals: true },
      activation: "NEXT CASE",
    });
    const before = discordMessages.length,
      body = {
        focus: "NONE",
        sendDiscord: true,
        idempotencyKey: "discord-delivery-fixture",
      };
    const row = (await (await call("/admin/emergency", body)).json()) as {
      id: string;
      uuid: string;
    };
    expect((await done(row.id)).status).toBe("COMPLETED");
    await call("/admin/emergency", body);
    expect(
      discordMessages.slice(before).filter((m) => m.content.includes(row.id)),
    ).toHaveLength(2);
    expect(discordMessages.at(-2)!.content).toContain(
      "AI OFFICE MEETING STARTED",
    );
    expect(discordMessages.at(-1)!.content).toContain("LOW R:R");
    expect(discordMessages.at(-1)!.content).toContain("minimum 1:10.00");
    expect(discordMessages.at(-1)!.allowed_mentions.parse).toEqual([]);
    const db = await mf.getD1Database("DB");
    expect(
      (await db
        .prepare(
          "SELECT COUNT(*) AS n FROM discord_deliveries WHERE case_uuid=? AND status='SENT'",
        )
        .bind(row.uuid)
        .first<{ n: number }>())!.n,
    ).toBe(2);
  }, 30000);
  it("public signal toggles and history filters enforce settings", async () => {
    const res = await call("/signals?direction=BUY", undefined, false);
    expect(res.status).toBe(200);
    const list = (await res.json()) as { items: Signal[] };
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items.every((s) => s.direction === "BUY")).toBe(true);
    expect(list.items[0]).not.toHaveProperty("basis");
    expect(list.items[0]).not.toHaveProperty("case_uuid");
    expect(list.items[0]).not.toHaveProperty("signal_uuid");
    await call("/admin/config", {
      config: { ...defaultConfig, publicSignals: true, publicHistory: false },
      activation: "NEXT CASE",
    });
    expect(
      (
        (await (await call("/signals", undefined, false)).json()) as {
          items: unknown[];
        }
      ).items,
    ).toEqual([]);
    await call("/admin/config", {
      config: { ...defaultConfig, publicSignals: false },
      activation: "NEXT CASE",
    });
    expect((await call("/signals", undefined, false)).status).toBe(401);
    expect(
      (await call("/signals/" + list.items[0].signal_id, undefined, false))
        .status,
    ).toBe(401);
  });
  it("published signal survives Durable Object eviction without duplicate outputs", async () => {
    const db = await mf.getD1Database("DB");
    const before = (await db
      .prepare("SELECT COUNT(*) AS n FROM signals")
      .first<{ n: number }>())!.n;
    await mf.unsafeEvictDurableObject("test-office", "Office", {
      name: "BTCUSDT.P",
    });
    const res = await call("/office/state");
    expect(res.status).toBe(200);
    expect(
      (await db
        .prepare("SELECT COUNT(*) AS n FROM signals")
        .first<{ n: number }>())!.n,
    ).toBe(before);
  }, 45000);
  it("resumes an interrupted analyst stage without calling completed characters again", async () => {
    scenario = "BUY";
    failure = "none";
    const db = await mf.getD1Database("DB");
    const original = (await db
      .prepare(
        "SELECT c.* FROM cases c WHERE c.status='COMPLETED' AND c.mode='LIVE' ORDER BY (SELECT COUNT(*) FROM ai_character_outputs a WHERE a.case_uuid=c.uuid) DESC LIMIT 1",
      )
      .first())!;
    const uuid = crypto.randomUUID();
    const id = "CASE-RECOVERY-FIXTURE";
    await db
      .prepare("INSERT INTO cases VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(
        uuid,
        id,
        "LIVE",
        "EMERGENCY",
        "BUY",
        "AI_ANALYSIS",
        original.candle_timestamp,
        original.config_version,
        original.context,
        null,
        Date.now(),
        Date.now(),
        uuid,
      )
      .run();
    await db
      .prepare(
        "INSERT INTO ai_character_outputs SELECT ?,character_id,snapshot FROM ai_character_outputs WHERE case_uuid=? AND character_id NOT IN ('risk','boss')",
      )
      .bind(uuid, original.uuid)
      .run();
    expect(
      (await db
        .prepare(
          "SELECT COUNT(*) n FROM ai_character_outputs WHERE case_uuid=? AND character_id NOT IN ('risk','boss')",
        )
        .bind(uuid)
        .first<{ n: number }>())!.n,
    ).toBe(8);
    const before = aiRequests;
    const ns = await mf.getDurableObjectNamespace("OFFICE");
    const response = await ns
      .get(ns.idFromName("BTCUSDT.P"))
      .fetch("https://test/__test/alarm");
    expect(response.status).toBe(200);
    expect((await done(id)).status).toBe("COMPLETED");
    expect(aiRequests - before).toBe(2); // Only Risk Manager and Boss AI inference remain; Discord traffic is excluded.
    expect(
      (await db
        .prepare("SELECT COUNT(*) n FROM signals WHERE case_uuid=?")
        .bind(uuid)
        .first<{ n: number }>())!.n,
    ).toBe(1);
  }, 15000);
  it("temporary D1 failure recovers with saved AI outputs and an audit event", async () => {
    // A previous queue fixture changes the market to a downtrend.
    scenario = "SELL";
    await mf
      .getD1Database("DB")
      .then((db) =>
        db.exec(
          "CREATE TRIGGER fixture_busy BEFORE UPDATE OF status ON cases WHEN NEW.status='RISK_REVIEW' BEGIN SELECT RAISE(ABORT,'D1_ERROR: temporarily unavailable'); END;",
        ),
      );
    const row = (await (
      await call("/admin/emergency", {
        focus: "BUY",
        sendDiscord: false,
        idempotencyKey: "recover-d1-once-fixture",
      })
    ).json()) as { id: string; uuid: string };
    const db = await mf.getD1Database("DB");
    try {
      for (let i = 0; i < 100; i++) {
        const event = await db
          .prepare(
            "SELECT 1 n FROM case_events WHERE case_uuid=? AND status='RECOVERY_PENDING'",
          )
          .bind(row.uuid)
          .first();
        if (event) break;
        await new Promise((r) => setTimeout(r, 30));
      }
      expect(
        await db
          .prepare(
            "SELECT 1 n FROM case_events WHERE case_uuid=? AND status='RECOVERY_PENDING'",
          )
          .bind(row.uuid)
          .first(),
      ).not.toBeNull();
    } finally {
      await db.exec("DROP TRIGGER fixture_busy");
    }
    expect((await done(row.id)).status).toBe("COMPLETED");
    expect(
      (await db
        .prepare("SELECT COUNT(*) n FROM ai_runs WHERE case_uuid=?")
        .bind(row.uuid)
        .first<{ n: number }>())!.n,
    ).toBe(10);
  }, 15000);
  it("persistent D1 stage failure stops after three recoveries without repeated AI calls", async () => {
    const db = await mf.getD1Database("DB");
    await db.exec(
      "CREATE TRIGGER fixture_busy BEFORE UPDATE OF status ON cases WHEN NEW.status='RISK_REVIEW' BEGIN SELECT RAISE(ABORT,'D1_ERROR: temporarily unavailable'); END;",
    );
    try {
      const row = (await (
        await call("/admin/emergency", {
          focus: "BUY",
          sendDiscord: false,
          idempotencyKey: "recover-d1-limit-fixture",
        })
      ).json()) as { id: string; uuid: string };
      expect((await done(row.id)).status).toBe("FAILED");
      expect(
        (await db
          .prepare(
            "SELECT COUNT(*) n FROM case_events WHERE case_uuid=? AND status='RECOVERY_PENDING'",
          )
          .bind(row.uuid)
          .first<{ n: number }>())!.n,
      ).toBe(3);
      expect(
        (await db
          .prepare("SELECT COUNT(*) n FROM ai_runs WHERE case_uuid=?")
          .bind(row.uuid)
          .first<{ n: number }>())!.n,
      ).toBe(8);
      expect(
        (await db
          .prepare("SELECT COUNT(*) n FROM signals WHERE case_uuid=?")
          .bind(row.uuid)
          .first<{ n: number }>())!.n,
      ).toBe(0);
    } finally {
      await db.exec("DROP TRIGGER fixture_busy");
      scenario = "BUY";
    }
  }, 15000);
  it("idle retention clears expired raw prompts and sessions while preserving structured audit", async () => {
    const db = await mf.getD1Database("DB");
    const old = Date.now() - 100 * 86400000;
    const original = (await db
      .prepare("SELECT * FROM ai_runs LIMIT 1")
      .first())!;
    const run = crypto.randomUUID();
    await db
      .prepare("INSERT INTO ai_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(
        run,
        original.case_uuid,
        original.character_id,
        original.provider,
        original.model,
        original.prompt_version,
        1,
        "SUCCESS",
        64,
        "expired raw",
        "expired prompt",
        old,
      )
      .run();
    await db.prepare("INSERT INTO sessions VALUES ('fixture-expired',0)").run();
    await db
      .prepare("INSERT INTO login_limits VALUES ('fixture-expired',1,0)")
      .run();
    await db
      .prepare("INSERT INTO api_limits VALUES ('fixture-expired',1,0)")
      .run();
    const ns = await mf.getDurableObjectNamespace("OFFICE");
    const stub = ns.get(ns.idFromName("BTCUSDT.P"));
    await stub.fetch("https://test/__test/idle");
    await stub.fetch("https://test/__test/alarm");
    const audit = await db
      .prepare("SELECT * FROM ai_runs WHERE uuid=?")
      .bind(run)
      .first();
    expect(audit).toMatchObject({
      raw: null,
      rendered_prompt: null,
      status: "SUCCESS",
      tokens: 64,
      model: original.model,
    });
    expect(
      await db
        .prepare("SELECT * FROM ai_character_outputs WHERE case_uuid=? LIMIT 1")
        .bind(original.case_uuid)
        .first(),
    ).not.toBeNull();
    expect(
      await db
        .prepare("SELECT * FROM sessions WHERE token_hash='fixture-expired'")
        .first(),
    ).toBeNull();
    expect(
      await db
        .prepare("SELECT * FROM login_limits WHERE key='fixture-expired'")
        .first(),
    ).toBeNull();
    expect(
      await db
        .prepare("SELECT * FROM api_limits WHERE key='fixture-expired'")
        .first(),
    ).toBeNull();
    const { alarm } = (await (
      await stub.fetch("https://test/__test/storage")
    ).json()) as { alarm: number };
    expect(alarm).toBeGreaterThan(Date.now() + 23 * 3600000);
  });
  it("scanner history filter matches supporting scanner snapshots and rejects unknown scanners", async () => {
    const db = await mf.getD1Database("DB");
    const signal = (await db
      .prepare("SELECT snapshot,case_uuid FROM signals LIMIT 1")
      .first<{ snapshot: string; case_uuid: string }>())!;
    const s = JSON.parse(signal.snapshot) as Signal;
    const context = JSON.parse(
      (await db
        .prepare("SELECT context FROM cases WHERE uuid=?")
        .bind(signal.case_uuid)
        .first<{ context: string }>())!.context,
    ) as { scanners: { name: string; direction: string }[] };
    const name = context.scanners.find(
      (x) => x.direction === s.direction,
    )?.name;
    expect(name).toBeTruthy();
    const filtered = await call(`/signals?scanner=${name}`);
    expect(filtered.status).toBe(200);
    const list = (await filtered.json()) as { items: Signal[] };
    expect(list.items.map((x) => x.signal_id)).toContain(s.signal_id);
    for (const item of list.items) {
      const c = JSON.parse(
        (await db
          .prepare("SELECT context FROM cases WHERE id=?")
          .bind(item.case_id)
          .first<{ context: string }>())!.context,
      ) as typeof context;
      expect(
        c.scanners.some(
          (x) => x.name === name && x.direction === item.direction,
        ),
      ).toBe(true);
    }
    expect((await call("/signals?scanner=unknown")).status).toBe(400);
  });
  it("ambiguous Discord deliveries require confirmed Admin review and cannot be retried", async () => {
    const db = await mf.getD1Database("DB");
    const key = "fixture-review-unknown";
    await db
      .prepare(
        "INSERT INTO discord_deliveries(key,case_uuid,kind,status,payload,created_at) VALUES (?,?,?,'PENDING','{}',?)",
      )
      .bind(key, "fixture", "SIGNAL", Date.now())
      .run();
    const ns = await mf.getDurableObjectNamespace("OFFICE");
    const stub = ns.get(ns.idFromName("BTCUSDT.P"));
    discordStatus = "timeout";
    try {
      await stub.fetch("https://test/__test/deliveries");
    } finally {
      discordStatus = 204;
    }
    expect(
      (await db
        .prepare("SELECT status FROM discord_deliveries WHERE key=?")
        .bind(key)
        .first())!.status,
    ).toBe("UNKNOWN");
    const body = { key, action: "RETRY", confirmed: true };
    expect((await call("/admin/deliveries/review", body, false)).status).toBe(
      401,
    );
    expect(
      (await call("/admin/deliveries/review", body, true, "https://evil.test"))
        .status,
    ).toBe(403);
    expect((await call("/admin/deliveries/review", body)).status).toBe(409);
    expect(
      (await call("/admin/deliveries/review", { key, action: "MARK_SENT" }))
        .status,
    ).toBe(400);
    const before = requests;
    expect(
      (
        await call("/admin/deliveries/review", {
          key,
          action: "MARK_SENT",
          confirmed: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("/admin/deliveries/review", {
          key,
          action: "MARK_SENT",
          confirmed: true,
        })
      ).status,
    ).toBe(409);
    await stub.fetch("https://test/__test/deliveries");
    expect(requests).toBe(before);
    expect(
      (await db
        .prepare(
          "SELECT action FROM discord_delivery_reviews WHERE delivery_key=?",
        )
        .bind(key)
        .first())!.action,
    ).toBe("MARK_SENT");
  });
  it("Discord rate limits respect retry time and attempt cap; failed deliveries can be reviewed", async () => {
    const db = await mf.getD1Database("DB");
    const key = "fixture-review-rate-limit";
    await db
      .prepare(
        "INSERT INTO discord_deliveries(key,case_uuid,kind,status,payload,created_at) VALUES (?,?,?,'PENDING','{}',?)",
      )
      .bind(key, "fixture", "SIGNAL", Date.now() - 3600000)
      .run();
    const ns = await mf.getDurableObjectNamespace("OFFICE");
    const stub = ns.get(ns.idFromName("BTCUSDT.P"));
    discordStatus = 429;
    try {
      await stub.fetch("https://test/__test/deliveries");
      const row = await db
        .prepare("SELECT * FROM discord_deliveries WHERE key=?")
        .bind(key)
        .first();
      expect(row).toMatchObject({ status: "PENDING", attempts: 1 });
      expect(row!.next_attempt_at as number).toBeGreaterThan(
        Date.now() + 110000,
      );
      const before = requests;
      await stub.fetch("https://test/__test/deliveries");
      expect(requests).toBe(before);
      await db
        .prepare(
          "UPDATE discord_deliveries SET next_attempt_at=0,attempts=3 WHERE key=?",
        )
        .bind(key)
        .run();
      await stub.fetch("https://test/__test/deliveries");
      expect(
        await db
          .prepare("SELECT status,attempts FROM discord_deliveries WHERE key=?")
          .bind(key)
          .first(),
      ).toMatchObject({ status: "FAILED", attempts: 4 });
    } finally {
      discordStatus = 204;
    }
    expect(
      (
        await call("/admin/deliveries/review", {
          key,
          action: "RETRY",
          confirmed: true,
        })
      ).status,
    ).toBe(200);
    await stub.fetch("https://test/__test/deliveries");
    expect(
      await db
        .prepare("SELECT status,attempts FROM discord_deliveries WHERE key=?")
        .bind(key)
        .first(),
    ).toMatchObject({ status: "SENT", attempts: 1 });
  });
  it("delivery interruption age is measured from claim time, not old queue creation", async () => {
    const db = await mf.getD1Database("DB");
    const key = "fixture-recent-send";
    await db
      .prepare(
        "INSERT INTO discord_deliveries(key,case_uuid,kind,status,payload,created_at,last_attempt_at) VALUES (?,?,?,'SENDING','{}',?,?)",
      )
      .bind(key, "fixture", "SIGNAL", Date.now() - 3600000, Date.now())
      .run();
    const ns = await mf.getDurableObjectNamespace("OFFICE");
    const stub = ns.get(ns.idFromName("BTCUSDT.P"));
    await stub.fetch("https://test/__test/deliveries");
    expect(
      (await db
        .prepare("SELECT status FROM discord_deliveries WHERE key=?")
        .bind(key)
        .first())!.status,
    ).toBe("SENDING");
    await db
      .prepare("UPDATE discord_deliveries SET last_attempt_at=0 WHERE key=?")
      .bind(key)
      .run();
    await stub.fetch("https://test/__test/deliveries");
    expect(
      (await db
        .prepare("SELECT status FROM discord_deliveries WHERE key=?")
        .bind(key)
        .first())!.status,
    ).toBe("UNKNOWN");
    expect(
      (
        await call("/admin/deliveries/review", {
          key,
          action: "DISMISS",
          confirmed: true,
        })
      ).status,
    ).toBe(200);
  });
  it("signal publication recovery finishes without AI calls or duplicate signals", async () => {
    const db = await mf.getD1Database("DB");
    const row = (await db
      .prepare(
        "SELECT c.* FROM cases c JOIN signals s ON s.case_uuid=c.uuid WHERE c.status='COMPLETED' LIMIT 1",
      )
      .first())!;
    const before = (await db
      .prepare("SELECT COUNT(*) n FROM signals")
      .first<{ n: number }>())!.n;
    await db
      .prepare("UPDATE cases SET status='SIGNAL_CREATED' WHERE uuid=?")
      .bind(row.uuid)
      .run();
    const calls = requests;
    const ns = await mf.getDurableObjectNamespace("OFFICE");
    const stub = ns.get(ns.idFromName("BTCUSDT.P"));
    await stub.fetch("https://test/__test/alarm");
    expect((await done(row.id as string)).status).toBe("COMPLETED");
    expect(requests).toBe(calls);
    expect(
      (await db
        .prepare("SELECT COUNT(*) n FROM signals")
        .first<{ n: number }>())!.n,
    ).toBe(before);
    expect(
      ((await (await call("/office/state")).json()) as { office: string })
        .office,
    ).toBe("RETURN_TO_DESK");
  });
  it("daily quota is atomic and retry-safe; token budget blocks calls before billing", async () => {
    const db = await mf.getD1Database("DB");
    const count = (await db
      .prepare("SELECT COUNT(*) AS n FROM cases WHERE mode='LIVE'")
      .first<{ n: number }>())!.n;
    await call("/admin/config", {
      config: {
        ...defaultConfig,
        budgets: {
          ...defaultConfig.budgets,
          casesPerDay: count + 1,
          tokensPerCase: 1000,
        },
      },
      activation: "NEXT CASE",
    });
    const body = {
      focus: "NONE",
      sendDiscord: false,
      idempotencyKey: "budget-fixture-one",
    };
    const row = (await (await call("/admin/emergency", body)).json()) as {
      id: string;
    };
    const before = requests;
    const c = await done(row.id);
    expect(c.status).toBe("FAILED");
    expect(requests).toBe(before);
    expect(
      ((await (await call("/admin/emergency", body)).json()) as { id: string })
        .id,
    ).toBe(row.id);
    expect(
      (
        await call("/admin/emergency", {
          ...body,
          idempotencyKey: "budget-fixture-two",
        })
      ).status,
    ).toBe(400);
  }, 15000);
  it("login throttling persists and rejects repeated failures", async () => {
    let status = 0;
    for (let i = 0; i < 6; i++)
      status = (await call("/auth/login", { password: "wrong" }, false)).status;
    expect(status).toBe(429);
  });
  it("logout invalidates session and expired sessions are rejected", async () => {
    const db = await mf.getD1Database("DB");
    await db.prepare("UPDATE sessions SET expires_at=0").run();
    expect((await call("/admin/config")).status).toBe(401);
    expect((await call("/auth/logout", {})).status).toBe(200);
  });
});
