import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { readFile, mkdir, readdir } from "node:fs/promises";
import { pbkdf2Sync } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  Miniflare,
  convertV4MiniflareOptions,
  Response as MFResponse,
} from "miniflare";
import { defaultConfig, type Signal } from "../src/core/contracts";
let mf: Miniflare,
  cookie = "";
let scenario: "BUY" | "SELL" | "NO_TRADE" | "TIE" | "BOSS_REVERSE" = "BUY";
let failure: "none" | "primary" | "all" = "none";
let release: (() => void) | undefined;
let gate: Promise<void> | undefined;
let requests = 0;
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
        GEMINI_API_KEY: "fixture-only-gemini",
        DISCORD_MEETING_WEBHOOK:
          "https://discord.com/api/webhooks/fixture/meeting",
        DISCORD_SIGNAL_WEBHOOK:
          "https://discord.com/api/webhooks/fixture/signal",
      },
      serviceBindings: {
        ASSETS: async () => new MFResponse("<html><body>BYGA</body></html>"),
      },
      outboundService: async (request) => {
        requests++;
        const u = new URL(request.url);
        if (u.hostname === "discord.com") {
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
        if (gate) await gate;
        if (
          failure === "all" ||
          (failure === "primary" && u.hostname === "api.openai.com")
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
            ? /^(Liquidity|Volume|Quant) Analyst/.test(prompt)
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
    "CREATE TABLE candles(symbol TEXT,timeframe TEXT,timestamp INTEGER,open REAL,high REAL,low REAL,close REAL,volume REAL,PRIMARY KEY(symbol,timeframe,timestamp));",
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
        .prepare("INSERT INTO candles VALUES (?,?,?,?,?,?,?,?)")
        .bind(
          "BTCUSDT",
          tf,
          latest - (319 - i) * duration,
          close - 0.3,
          close + 1,
          close - 1,
          close,
          100 + (i % 7),
        );
    });
    await market.batch(statements);
  }
}, 60000);
afterAll(async () => {
  await mf?.dispose();
});
describe.sequential("Real Worker / D1 / Durable Object workflow", () => {
  it("rejects unauthorized Admin and private signals", async () => {
    expect((await call("/admin/config", undefined, false)).status).toBe(401);
    expect((await call("/signals", undefined, false)).status).toBe(401);
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
    ).toBe(8);
    const publicRes = await call(`/cases/${item.id}/public`, undefined, false);
    const text = await publicRes.text();
    expect(text).not.toContain("fixture-only-ai-key");
    expect(text).not.toContain("primary_provider");
    expect(text).not.toContain("rendered_prompt");
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
    await call("/admin/test-provider", { id: "openai" });
    await call("/admin/test-provider", { id: "gemini" });
  }, 30000);
  it("APPLY NOW cancels in-flight case and replacement owns the new config", async () => {
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
    for (let i = 0; i < 100; i++) {
      const row = (await (await call("/admin/cases/" + item.id)).json()) as {
        status: string;
      };
      if (row.status === "AI_ANALYSIS") break;
      await new Promise((r) => setTimeout(r, 30));
    }
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
          "SELECT timeframe,timestamp FROM candles ORDER BY timeframe,timestamp",
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
            "UPDATE candles SET open=?,high=?,low=?,close=?,volume=100 WHERE timeframe=? AND timestamp=?",
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
      name: "BTCUSDT",
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
        "SELECT * FROM cases WHERE status='COMPLETED' AND mode='LIVE' LIMIT 1",
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
    const before = requests;
    const ns = await mf.getDurableObjectNamespace("OFFICE");
    const response = await ns
      .get(ns.idFromName("BTCUSDT"))
      .fetch("https://test/__test/alarm");
    expect(response.status).toBe(200);
    expect((await done(id)).status).toBe("COMPLETED");
    expect(requests - before).toBe(2); // Only Risk Manager and Boss remain.
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
    ).toBe(8);
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
      ).toBe(6);
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
    const ns = await mf.getDurableObjectNamespace("OFFICE");
    const stub = ns.get(ns.idFromName("BTCUSDT"));
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
    const stub = ns.get(ns.idFromName("BTCUSDT"));
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
    const stub = ns.get(ns.idFromName("BTCUSDT"));
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
    const stub = ns.get(ns.idFromName("BTCUSDT"));
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
    const stub = ns.get(ns.idFromName("BTCUSDT"));
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
