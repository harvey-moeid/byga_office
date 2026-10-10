import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { mkdir, readFile, readdir } from "node:fs/promises";
import {
  Miniflare,
  convertV4MiniflareOptions,
  Response as MFResponse,
} from "miniflare";
import {
  defaultConfig,
  caseStopMessage,
  type AnalystResult,
  type Signal,
} from "../src/core/contracts";
import type { CaseRow } from "../src/server/office";

let mf: Miniflare;
let calls: number;
let gate: Promise<void> | undefined;
let release: (() => void) | undefined;
let vote: "BUY" | "SELL" | "NO_TRADE" | "TIE";
let bossTieVote: "BUY" | "SELL" | "NO_TRADE";
type TestNamespace = Awaited<
  ReturnType<Miniflare["getDurableObjectNamespace"]>
>;
type TestStub = ReturnType<TestNamespace["get"]>;
let live: TestStub;
let simulation: TestStub;
let db: D1Database;
let chart: D1Database;
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
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function until(check: () => Promise<boolean> | boolean) {
  for (let i = 0; i < 300; i++) {
    if (await check()) return;
    await sleep(20);
  }
  throw new Error("Safety test did not reach the expected stage");
}
async function row(uuid: string) {
  return (await db
    .prepare("SELECT * FROM cases WHERE uuid=?")
    .bind(uuid)
    .first<CaseRow>())!;
}
async function emergency(key: string, focus = "NONE") {
  const response = await live.fetch("https://test/emergency", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idempotencyKey: key, focus, sendDiscord: false }),
  });
  expect(response.status, await response.clone().text()).toBe(202);
  const item = (await response.json()) as CaseRow;
  await live.fetch("https://test/__test/pause");
  return item;
}
async function config(overrides: Partial<typeof defaultConfig>) {
  const r = await live.fetch("https://test/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      config: { ...defaultConfig, ...overrides },
      activation: "NEXT CASE",
    }),
  });
  expect(r.status).toBe(200);
}
async function alarm() {
  await live.fetch("https://test/__test/alarm");
}
async function signals(uuid: string) {
  return (await db
    .prepare("SELECT COUNT(*) n FROM signals WHERE case_uuid=?")
    .bind(uuid)
    .first<{ n: number }>())!.n;
}
async function patchContext(
  uuid: string,
  change: (context: Record<string, unknown>) => void,
) {
  const context = JSON.parse((await row(uuid)).context);
  change(context);
  await db
    .prepare("UPDATE cases SET context=? WHERE uuid=?")
    .bind(JSON.stringify(context), uuid)
    .run();
}
beforeAll(async () => {
  await mkdir(".wrangler/test", { recursive: true });
  await build({
    entryPoints: ["tests/worker-harness.ts"],
    outfile: ".wrangler/test/safety-worker.mjs",
    bundle: true,
    format: "esm",
    platform: "browser",
    external: ["cloudflare:workers"],
    logLevel: "silent",
  });
});
beforeEach(async () => {
  calls = 0;
  gate = undefined;
  release = undefined;
  vote = "BUY";
  bossTieVote = "NO_TRADE";
  mf = new Miniflare(
    convertV4MiniflareOptions({
      name: "trading-safety",
      scriptPath: ".wrangler/test/safety-worker.mjs",
      modules: true,
      compatibilityDate: "2026-10-01",
      durableObjects: { OFFICE: { className: "Office", useSQLite: true } },
      d1Databases: ["DB", "CHART_DB"],
      bindings: {
        APP_ENV: "test",
        PUBLIC_ORIGIN: "https://safety.test",
        CHART_SCHEMA: JSON.stringify(schema),
        OPENROUTER_API_KEY: "fixture-key",
        GEMINI_API_KEY: "fixture-key",
      },
      serviceBindings: { ASSETS: async () => new MFResponse("BYGA") },
      outboundService: async (request) => {
        calls++;
        if (gate) await gate;
        const body = (await request.json()) as {
          messages?: { content: string }[];
          contents?: { parts: { text: string }[] }[];
        };
        const prompt =
          body.messages?.[0]?.content ??
          body.contents?.[0]?.parts[0]?.text ??
          "";
        const analystVote =
          vote === "TIE"
            ? /^(Liquidity|Volume|Quant|Market Positioning) Analyst/.test(
                prompt,
              )
              ? "SELL"
              : "BUY"
            : vote;
        const roleVote =
          prompt.startsWith("Head Trader") && vote === "TIE"
            ? bossTieVote
            : /^(Risk Manager|Head Trader)/.test(prompt) &&
                prompt.includes('"direction":null')
              ? "NO_TRADE"
              : analystVote;
        const output = {
          vote: roleVote,
          confidence: 75,
          summary: "Safety fixture",
          reasoning: "Fixture evidence",
          evidence: [
            {
              code: "DIRECTIONAL_BIAS",
              direction: roleVote === "NO_TRADE" ? "NONE" : roleVote,
              detail: "Fixture",
            },
          ],
          risk_flags: [],
        };
        const text = JSON.stringify(output);
        return MFResponse.json(
          request.url.includes("googleapis")
            ? {
                candidates: [{ content: { parts: [{ text }] } }],
                usageMetadata: { totalTokenCount: 64 },
              }
            : {
                choices: [{ message: { content: text } }],
                usage: { total_tokens: 64 },
              },
        );
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
    const latest =
      Math.floor((Date.now() - duration - 5000) / duration) * duration;
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
  simulation = ns.get(ns.idFromName("BTCUSDT.P:simulation"));
  await live.fetch("https://test/state");
  await simulation.fetch("https://test/state");
});
afterEach(async () => {
  gate = undefined;
  release?.();
  await mf?.dispose();
});

describe.sequential("Trading publication and queue safety", () => {
  it("fails an invalid legacy configuration without blocking the next queued case", async () => {
    const old = await emergency("safety-invalid-legacy-config");
    await patchContext(old.uuid, (context) => {
      (context.config as typeof defaultConfig).scanner.ema = [200, 50, 20];
    });
    await alarm();
    expect((await row(old.uuid)).status).toBe("FAILED");
    expect(calls).toBe(0);
    expect(await signals(old.uuid)).toBe(0);
    const next = await emergency("safety-after-invalid-config");
    await alarm();
    expect((await row(next.uuid)).status).toBe("COMPLETED");
    expect(await signals(next.uuid)).toBe(1);
    expect(calls).toBe(10);
  });
  it("uses the captured market tick size for final signal prices and R:R", async () => {
    await chart.exec(
      "UPDATE candles SET open=open*100,high=high*100,low=low*100,close=close*100",
    );
    const item = await emergency("safety-signal-tick-grid");
    await patchContext(item.uuid, (context) => {
      context.tick_size = 5;
    });
    await alarm();
    const final = await row(item.uuid);
    expect(final.status).toBe("COMPLETED");
    const signal = JSON.parse(final.result!).signal as Signal;
    expect(signal.tick_size).toBe(5);
    for (const price of [
      signal.entry_low,
      signal.entry_high,
      signal.preferred_entry,
      signal.stop_loss,
      signal.take_profit,
    ])
      expect(price / 5).toBe(Math.round(price / 5));
    expect(signal.risk_reward).toBe(
      Math.abs(signal.take_profit - signal.preferred_entry) /
        Math.abs(signal.preferred_entry - signal.stop_loss),
    );
  });
  it("never publishes a non-positive risk plan from valid extreme-volatility data", async () => {
    await config({ entryAtr: 3, slAtr: 5 });
    await chart.exec(
      "UPDATE candles SET open=100,high=101,low=99,close=100,volume=100",
    );
    await chart.batch(
      ["H1", "M15", "M5"].map((tf) =>
        chart
          .prepare(
            "UPDATE candles SET open=1,high=2,low=0.5,close=1 WHERE timeframe=? AND timestamp IN (SELECT timestamp FROM candles WHERE timeframe=? ORDER BY timestamp DESC LIMIT 2)",
          )
          .bind(tf, tf),
      ),
    );
    const item = await emergency("safety-invalid-risk-plan");
    await alarm();
    const final = await row(item.uuid);
    expect(final.status).toBe("NO_CONSENSUS");
    expect(JSON.parse(final.result!).reason).toBe("INVALID_RISK_PROPOSAL");
    expect(await signals(item.uuid)).toBe(0);
  });
  it("revalidates a saved Risk Manager response on recovery without another paid call", async () => {
    const item = await emergency("safety-saved-risk-authority");
    const invalid: AnalystResult = {
      id: "risk",
      status: "SUCCESS",
      flags: [],
      validationErrors: [],
      prompt_version: "risk-v1",
      output: {
        vote: "SELL",
        confidence: 75,
        summary: "Old invalid review",
        reasoning: "Opposing review",
        evidence: [
          { code: "DIRECTIONAL_BIAS", direction: "SELL", detail: "Fixture" },
        ],
        risk_flags: [],
        price_levels: { entry: 900, stop_loss: 1000, take_profit: 800 },
      },
    };
    await db
      .prepare("INSERT INTO ai_character_outputs VALUES (?,?,?)")
      .bind(item.uuid, "risk", JSON.stringify(invalid))
      .run();
    await alarm();
    const final = await row(item.uuid);
    expect(final.status).toBe("COMPLETED");
    const result = JSON.parse(final.result!);
    expect(result.signal.direction).toBe("BUY");
    expect(result.riskReview.status).toBe("UNAVAILABLE");
    expect(result.riskReview.output).toBeUndefined();
    expect(result.riskReview.validationErrors.join(" ")).toContain(
      "Risk Manager must support",
    );
    expect(calls).toBe(9);
  });
  it("persists a delayed cron scan, preserves its alarm and consumes each candle once", async () => {
    await config({ processingDelaySeconds: 120, scannerConsensusMin: 4 });
    const start = Date.now();
    const response = await live.fetch("https://test/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledTime: start }),
    });
    expect(response.status).toBe(200);
    const scheduled = (await response.json()) as { scan_after: number };
    expect(scheduled.scan_after).toBe(start + 120000);
    await live.fetch("https://test/__test/pause");
    await alarm(); // An early watchdog must not consume the future event.
    const stored = (await (
      await live.fetch("https://test/__test/storage")
    ).json()) as { pendingTick: number; alarm: number };
    expect(stored.pendingTick).toBe(scheduled.scan_after);
    expect(stored.alarm).toBe(scheduled.scan_after);
    expect(
      (await db
        .prepare("SELECT COUNT(*) n FROM scanner_runs")
        .first<{ n: number }>())!.n,
    ).toBe(0);
    await live.fetch("https://test/__test/tick-due");
    await alarm();
    expect(
      (await db
        .prepare("SELECT COUNT(*) n FROM scanner_runs")
        .first<{ n: number }>())!.n,
    ).toBe(1);
    expect(
      (
        (await (await live.fetch("https://test/__test/storage")).json()) as {
          pendingTick?: number;
        }
      ).pendingTick,
    ).toBeUndefined();
    await live.fetch("https://test/__test/tick-due");
    await alarm();
    expect(
      (await db
        .prepare("SELECT COUNT(*) n FROM scanner_runs")
        .first<{ n: number }>())!.n,
    ).toBe(1);
    expect(calls).toBe(0);
  });
  it("isolates simulation alarms and coalesces concurrent live alarms without duplicate AI calls", async () => {
    const item = await emergency("safety-concurrent");
    gate = new Promise<void>((r) => {
      release = r;
    });
    const first = live.fetch("https://test/__test/alarm");
    await until(() => calls === 8);
    await simulation.fetch("https://test/__test/alarm");
    const second = live.fetch("https://test/__test/alarm");
    await sleep(100);
    expect(calls).toBe(8);
    gate = undefined;
    release!();
    await Promise.all([first, second]);
    expect(calls).toBe(10);
    expect((await row(item.uuid)).status).toBe("COMPLETED");
    expect(await signals(item.uuid)).toBe(1);
    expect(
      (await db
        .prepare("SELECT COUNT(*) n FROM ai_runs WHERE case_uuid=?")
        .bind(item.uuid)
        .first<{ n: number }>())!.n,
    ).toBe(10);
  });
  it("the live actor never processes queued historical simulations", async () => {
    const response = await simulation.fetch("https://test/simulation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timestamp: Date.now() - 10000,
        configMode: "CURRENT",
        replayMode: "COMPATIBLE",
        idempotencyKey: "safety-simulation",
      }),
    });
    expect(response.status).toBe(202);
    const item = (await response.json()) as CaseRow;
    await simulation.fetch("https://test/__test/pause");
    await alarm();
    expect(calls).toBe(0);
    expect((await row(item.uuid)).status).toBe("QUEUED");
    await simulation.fetch("https://test/__test/alarm");
    expect((await row(item.uuid)).status).toBe("COMPLETED");
    expect(await signals(item.uuid)).toBe(0);
  });
  it.each([15, 0])(
    "blocks revalidated duplicate AUTO cases with cooldown %s minutes",
    async (minutes) => {
      await config({
        cooldownAnchor: "FROM_FINAL_DECISION",
        cooldownMinutes: minutes,
      });
      const first = await emergency("safety-queue-first");
      const second = await emergency("safety-queue-second");
      for (const [i, item] of [first, second].entries())
        await db
          .prepare(
            "UPDATE cases SET source='AUTO',direction='BUY',candle_timestamp=? WHERE uuid=?",
          )
          .bind(item.candle_timestamp - (i + 1) * 300000, item.uuid)
          .run();
      await alarm();
      const count = calls;
      expect((await row(first.uuid)).status).toBe("COMPLETED");
      // Emulate interruption after the D1 commit but before its storage anchor.
      await live.fetch("https://test/__test/clear-cooldown");
      await alarm();
      const skipped = await row(second.uuid);
      expect(skipped.status).toBe("STALE");
      expect(JSON.parse(skipped.result!).reason).toBe(
        minutes ? "AUTO_COOLDOWN_ACTIVE" : "AUTO_SNAPSHOT_ALREADY_PROCESSED",
      );
      expect(calls).toBe(count);
      expect(await signals(first.uuid)).toBe(1);
      expect(await signals(second.uuid)).toBe(0);
    },
  );
  it("does not reject an AUTO case for its own FROM_TRIGGER cooldown anchor", async () => {
    await live.fetch("https://test/tick", { method: "POST", body: "{}" });
    await live.fetch("https://test/__test/pause");
    const item = (await db
      .prepare("SELECT * FROM cases WHERE source='AUTO'")
      .first<CaseRow>())!;
    expect(item).toBeTruthy();
    await alarm();
    expect((await row(item.uuid)).status).toBe("COMPLETED");
    expect(await signals(item.uuid)).toBe(1);
  });
  it.each(["BUY", "SELL", "NONE"])(
    "Emergency focus %s never supplies missing directional authority",
    async (focus) => {
      // A genuine flat market yields four NONE groups while structural risk
      // levels remain available. No forged group snapshot is needed.
      await chart.exec(
        "UPDATE candles SET open=100,close=100,high=101,low=99,volume=100",
      );
      const item = await emergency("safety-focus-" + focus, focus);
      const unavailable: AnalystResult = {
        id: "trend",
        status: "UNAVAILABLE",
        flags: [],
        validationErrors: [],
        prompt_version: "v1",
      };
      for (const id of [
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
      ])
        await db
          .prepare("INSERT INTO ai_character_outputs VALUES (?,?,?)")
          .bind(item.uuid, id, JSON.stringify({ ...unavailable, id }))
          .run();
      await alarm();
      const final = await row(item.uuid);
      expect(final.status).toBe("NO_CONSENSUS");
      expect(await signals(item.uuid)).toBe(0);
      expect(calls).toBe(0);
      expect(JSON.parse(final.result!).vote.direction).toBeNull();
    },
  );
  it("Emergency AI majority can oppose focus without deterministic consensus", async () => {
    await config({ scannerConsensusMin: 4 });
    vote = "SELL";
    const item = await emergency("safety-opposing-majority", "BUY");
    await alarm();
    const final = await row(item.uuid);
    expect(final.status).toBe("COMPLETED");
    expect((JSON.parse(final.result!).signal as Signal).direction).toBe("SELL");
  });
  it("Emergency abstentions without group consensus end in NO_CONSENSUS", async () => {
    await config({ scannerConsensusMin: 4 });
    vote = "NO_TRADE";
    const item = await emergency("safety-emergency-abstentions", "BUY");
    await alarm();
    const final = await row(item.uuid);
    expect(final.status).toBe("NO_CONSENSUS");
    expect(JSON.parse(final.result!).vote.counts.NO_TRADE).toBe(8);
    expect(await signals(item.uuid)).toBe(0);
  });
  it.each(["BUY", "SELL", "NO_TRADE"] as const)(
    "Emergency tie without group consensus respects Boss %s",
    async (choice) => {
      await config({ scannerConsensusMin: 4 });
      vote = "TIE";
      bossTieVote = choice;
      const item = await emergency("safety-tie-" + choice, "BUY");
      await alarm();
      const final = await row(item.uuid);
      const result = JSON.parse(final.result!);
      expect(result.vote.tie).toBe(true);
      expect(result.vote.counts.BUY).toBe(4);
      expect(result.vote.counts.SELL).toBe(4);
      expect(final.status).toBe(
        choice === "NO_TRADE" ? "NO_CONSENSUS" : "COMPLETED",
      );
      expect(result.signal?.direction ?? null).toBe(
        choice === "NO_TRADE" ? null : choice,
      );
    },
  );
  it("rejects a changed queued Emergency before paying for AI inference", async () => {
    const item = await emergency("safety-changed-before-analysis");
    await chart.exec("UPDATE candles SET volume=volume+1 WHERE timeframe='M5'");
    await alarm();
    const final = await row(item.uuid);
    expect(final.status).toBe("STALE");
    expect(JSON.parse(final.result!).reason).toBe(
      "MARKET_CHANGED_DURING_ANALYSIS",
    );
    expect(calls).toBe(0);
    expect(await signals(item.uuid)).toBe(0);
    const publicCase = (await (
      await mf.dispatchFetch(
        "https://safety.test/api/v1/cases/" + item.id + "/public",
      )
    ).json()) as { stop_reason: string; signal: unknown; context?: unknown };
    expect(publicCase.stop_reason).toBe(
      caseStopMessage(JSON.parse(final.result!).reason),
    );
    expect(publicCase.signal).toBeNull();
    expect(publicCase.context).toBeUndefined();
    const meeting = (await (
      await mf.dispatchFetch("https://safety.test/api/v1/office/meeting")
    ).json()) as {
      meeting: { case_id: string; finished: boolean; cancelled: boolean };
    };
    expect(meeting.meeting).toMatchObject({
      case_id: item.id,
      finished: true,
      cancelled: true,
    });
  });
  it.each(["missing", "changed"])(
    "rejects publication when chart data becomes %s during AI work",
    async (fault) => {
      const item = await emergency("safety-market-" + fault);
      gate = new Promise<void>((r) => {
        release = r;
      });
      const run = live.fetch("https://test/__test/alarm");
      await until(() => calls === 8);
      if (fault === "missing") await chart.exec("DELETE FROM candles");
      else
        await chart.exec(
          "UPDATE candles SET volume=volume+1 WHERE timeframe='M5'",
        );
      gate = undefined;
      release!();
      await run;
      const final = await row(item.uuid);
      expect(final.status).toBe("STALE");
      expect(JSON.parse(final.result!).reason).toBe(
        fault === "missing"
          ? "MARKET_UNAVAILABLE_BEFORE_PUBLICATION"
          : "MARKET_CHANGED_DURING_ANALYSIS",
      );
      expect(await signals(item.uuid)).toBe(0);
    },
  );
  it("rejects changed derivatives evidence even when candles are unchanged", async () => {
    const item = await emergency("safety-derivatives-change");
    gate = new Promise<void>((r) => {
      release = r;
    });
    const run = live.fetch("https://test/__test/alarm");
    await until(() => calls === 8);
    await chart.exec(
      "CREATE TABLE derivative_metrics(symbol TEXT,metric TEXT,timeframe TEXT,ts INTEGER,value REAL,value2 REAL,value3 REAL,source TEXT);",
    );
    await chart.batch([
      chart
        .prepare(
          "INSERT INTO derivative_metrics VALUES ('BTCUSDT','funding_rate','',?,-0.0002,NULL,NULL,'fixture')",
        )
        .bind(item.candle_timestamp),
      chart
        .prepare(
          "INSERT INTO derivative_metrics VALUES ('BTCUSDT','long_short_ratio','M5',?,0.82,NULL,NULL,'fixture')",
        )
        .bind(item.candle_timestamp),
    ]);
    gate = undefined;
    release!();
    await run;
    const final = await row(item.uuid);
    expect(final.status).toBe("STALE");
    expect(JSON.parse(final.result!).reason).toBe(
      "ANALYSIS_GROUPS_CHANGED_DURING_ANALYSIS",
    );
    expect(await signals(item.uuid)).toBe(0);
  });
  it("rejects an expired in-flight snapshot on recovery without refreshing old votes", async () => {
    const item = await emergency("safety-expired-recovery");
    await patchContext(item.uuid, (context) => {
      context.market_read_at = Date.now() - 300001;
    });
    await db
      .prepare("UPDATE cases SET status='AI_ANALYSIS' WHERE uuid=?")
      .bind(item.uuid)
      .run();
    await alarm();
    const final = await row(item.uuid);
    expect(final.status).toBe("STALE");
    expect(JSON.parse(final.result!).reason).toBe("DECISION_SNAPSHOT_EXPIRED");
    expect(await signals(item.uuid)).toBe(0);
    expect(calls).toBe(0);
  });
});
