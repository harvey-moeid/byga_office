import { createServer } from "node:http";
import { once } from "node:events";
import { pbkdf2Sync, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { build } from "esbuild";
import {
  Miniflare,
  convertV4MiniflareOptions,
  Response as MFResponse,
} from "miniflare";

const origin = "http://127.0.0.1:5175",
  port = 8788;
await mkdir(".wrangler/browser-api", { recursive: true });
await build({
  entryPoints: ["tests/browser-worker-harness.ts"],
  outfile: ".wrangler/browser-api/worker.mjs",
  bundle: true,
  format: "esm",
  platform: "browser",
  external: ["cloudflare:workers"],
  logLevel: "silent",
});
await build({
  stdin: {
    contents: 'export { defaultConfig } from "./src/core/contracts";',
    resolveDir: process.cwd(),
  },
  outfile: ".wrangler/browser-api/contracts.mjs",
  bundle: true,
  format: "esm",
  platform: "node",
  logLevel: "silent",
});
const { defaultConfig } =
  await import("../.wrangler/browser-api/contracts.mjs");
const salt = "0123456789abcdef0123456789abcdef";
const hash = `pbkdf2-sha256:100000:${salt}:${pbkdf2Sync("browser-fixture-password", Buffer.from(salt, "hex"), 100000, 32, "sha256").toString("hex")}`;
let outboundCalls = 0;
const mf = new Miniflare(
  convertV4MiniflareOptions({
    name: "browser-api",
    scriptPath: ".wrangler/browser-api/worker.mjs",
    modules: true,
    compatibilityDate: "2026-10-01",
    durableObjects: { OFFICE: { className: "Office", useSQLite: true } },
    d1Databases: ["DB", "CHART_DB"],
    bindings: {
      APP_ENV: "test",
      PUBLIC_ORIGIN: origin,
      ADMIN_PASSWORD_HASH: hash,
      CHART_SCHEMA: JSON.stringify({
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
      }),
    },
    serviceBindings: { ASSETS: async () => new MFResponse("Test fixture") },
    outboundService: async () => {
      outboundCalls++;
      throw new Error(
        "External provider and Discord traffic is forbidden in browser integration",
      );
    },
  }),
);
const db = await mf.getD1Database("DB"),
  chart = await mf.getD1Database("CHART_DB");
for (const file of (await readdir("migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort())
  await db.exec(await readFile(`migrations/${file}`, "utf8"));
await chart.exec(
  "CREATE TABLE candles(symbol TEXT,timeframe TEXT,timestamp INTEGER,open REAL,high REAL,low REAL,close REAL,volume REAL,PRIMARY KEY(symbol,timeframe,timestamp));",
);
for (const [tf, duration] of [
  ["H1", 3600000],
  ["M15", 900000],
  ["M5", 300000],
]) {
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
const ns = await mf.getDurableObjectNamespace("OFFICE"),
  live = ns.get(ns.idFromName("BTCUSDT.P"));
async function reset() {
  await live.fetch("https://internal/state");
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
      "admin_operations",
      "sessions",
      "login_limits",
      "api_limits",
    ].map((table) => db.prepare(`DELETE FROM ${table}`)),
  );
  const response = await live.fetch("https://internal/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config: defaultConfig, activation: "NEXT CASE" }),
  });
  if (!response.ok)
    throw new Error(`Fixture reset failed: ${await response.text()}`);
  const { id } = await response.json(),
    uuid = randomUUID(),
    now = Date.now();
  const analysis = {
    vote: "BUY",
    confidence: 75,
    summary: "Fixture entry 96.78 and target 104.08",
    reasoning: "Fixture stop ninety five",
    evidence: [],
    risk_flags: [],
    price_levels: { entry: 96.78, stop_loss: 95.77, take_profit: 104.08 },
  };
  await db.batch([
    db
      .prepare("INSERT INTO cases VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(
        uuid,
        "CASE-private-fixture",
        "LIVE",
        "EMERGENCY",
        "BUY",
        "COMPLETED",
        now - 600000,
        id,
        JSON.stringify({ config: defaultConfig }),
        JSON.stringify({
          analysts: [
            { id: "risk", status: "SUCCESS", output: analysis, flags: [] },
          ],
        }),
        now - 10000,
        now,
        "fixture:private",
      ),
    db
      .prepare("INSERT INTO ai_character_outputs VALUES (?,?,?)")
      .bind(
        uuid,
        "risk",
        JSON.stringify({
          id: "risk",
          status: "SUCCESS",
          output: analysis,
          flags: [],
        }),
      ),
  ]);
  outboundCalls = 0;
  return { timestamp: now - 60000, configVersion: id };
}
await reset();
const server = createServer(async (req, res) => {
  let reader;
  try {
    // Test control endpoints exist only in this local bridge, never in the Worker.
    if (req.url === "/__test/reset" && req.method === "POST") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(await reset()));
      return;
    }
    if (req.url === "/__test/stats") {
      const cases = (
        await db
          .prepare(
            "SELECT id,mode,source,status,idempotency_key FROM cases ORDER BY created_at",
          )
          .all()
      ).results;
      const simulations = (
        await db.prepare("SELECT * FROM simulation_runs").all()
      ).results;
      const operations = (
        await db.prepare("SELECT key,response FROM admin_operations").all()
      ).results;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({ cases, simulations, operations, outboundCalls }),
      );
      return;
    }
    if (req.url === "/__health") {
      res.end("ready");
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers))
      if (
        value !== undefined &&
        !["host", "connection", "content-length", "accept-encoding"].includes(
          key,
        )
      )
        headers.set(key, Array.isArray(value) ? value.join(",") : value);
    const response = await mf.dispatchFetch(origin + req.url, {
      method: req.method,
      headers,
      ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
    });
    res.statusCode = response.status;
    for (const [key, value] of response.headers)
      if (
        ![
          "content-length",
          "content-encoding",
          "transfer-encoding",
          "connection",
        ].includes(key)
      )
        res.setHeader(key, value);
    if (!response.body) {
      res.end();
      return;
    }
    reader = response.body.getReader();
    res.on("close", () => {
      void reader?.cancel().catch(() => {});
    });
    for (;;) {
      const { value, done } = await reader.read();
      if (done || res.destroyed) break;
      if (!res.write(value)) await once(res, "drain");
    }
    res.end();
  } catch (error) {
    if (!res.destroyed) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(error) }));
    }
  }
});
server.listen(port, "127.0.0.1");
console.log(`Isolated API fixture ready on ${port}`);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    server.close();
    void mf.dispose().finally(() => process.exit(0));
  });
