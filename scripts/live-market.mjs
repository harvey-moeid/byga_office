import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const configPath = process.env.BYGA_DEPLOY_CONFIG;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!configPath || !token) throw new Error("BYGA_DEPLOY_CONFIG and CLOUDFLARE_API_TOKEN are required.");
const config = JSON.parse(await readFile(configPath, "utf8"));
const chart = config.d1_databases.find(db => db.binding === "CHART_DB");
if (!chart) throw new Error("CHART_DB binding missing.");
await mkdir(".wrangler", { recursive: true });
const output = resolve(".wrangler/live-market-reader.mjs");
await build({ entryPoints: ["src/server/market.ts"], outfile: output, bundle: true, platform: "node", format: "esm" });
const { readMarket } = await import(pathToFileURL(output).href);
const CHART_DB = {
  prepare(sql) {
    if (!sql.trimStart().startsWith("SELECT ")) throw new Error("Live chart verification allows SELECT only.");
    return {
      bind(...params) {
        return {
          async all() {
            const response = await fetch(
              `https://api.cloudflare.com/client/v4/accounts/${config.account_id}/d1/database/${chart.database_id}/query`,
              {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ sql, params }),
                signal: AbortSignal.timeout(30000),
              },
            );
            const body = await response.json();
            if (!response.ok || !body.success || !body.result?.[0]?.success)
              throw new Error(`Real chart query failed (HTTP ${response.status}); check D1 token permissions.`);
            for (const row of body.result)
              if (row.meta?.rows_written || row.meta?.changed_db)
                throw new Error("Chart verification unexpectedly changed data.");
            return { results: body.result[0].results };
          },
        };
      },
    };
  },
};
const now = Date.now();
const market = await readMarket({ CHART_DB, CHART_SCHEMA: config.vars.CHART_SCHEMA }, now);
console.log(JSON.stringify({
  checked_at: new Date(now).toISOString(),
  market: "BTCUSDT",
  schema: "live",
  read_only: true,
  timeframes: Object.fromEntries(Object.entries(market).map(([tf, candles]) => [tf, {
    candles: candles.length,
    latest_closed_open: new Date(candles.at(-1).timestamp).toISOString(),
    validation: "OHLC, gaps and freshness passed",
  }])),
}, null, 2));
