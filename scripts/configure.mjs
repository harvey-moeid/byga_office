import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const environment = process.env.BYGA_ENV;
if (!["staging", "production"].includes(environment))
  throw new Error("BYGA_ENV must be staging or production.");
let defaults = {};
try {
  defaults = JSON.parse(await readFile(`deployment/${environment}.json`, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const settings = {
  account: process.env.CLOUDFLARE_ACCOUNT_ID || defaults.account_id,
  chart: process.env.BYGA_CHART_DB_ID || defaults.chart_db_id,
  application: process.env.BYGA_OFFICE_DB_ID || defaults.office_db_id,
  origin: process.env.BYGA_PUBLIC_ORIGIN || defaults.public_origin,
  schema: process.env.BYGA_CHART_SCHEMA
    ? JSON.parse(process.env.BYGA_CHART_SCHEMA)
    : defaults.chart_schema,
};
for (const [key, value] of Object.entries(settings))
  if (!value) throw new Error(`Missing deployment setting: ${key}. See docs/DEPLOYMENT.md.`);
if (!/^[a-f0-9]{32}$/i.test(settings.account))
  throw new Error("Invalid Cloudflare account ID.");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if ([settings.chart, settings.application].some(id => !uuid.test(id) || id.startsWith("00000000")) ||
    settings.chart === settings.application)
  throw new Error("Real, distinct chart and application D1 IDs are required.");
const origin = new URL(settings.origin);
if (origin.protocol !== "https:" || origin.origin !== settings.origin ||
    origin.username || origin.password)
  throw new Error("PUBLIC_ORIGIN must be an exact HTTPS origin without path or credentials.");
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
for (const key of ["table", "market", "timeframe", "timestamp", "open", "high", "low", "close", "volume"])
  if (!identifier.test(settings.schema[key] ?? ""))
    throw new Error(`Invalid chart schema identifier: ${key}`);
if (settings.schema.closed !== undefined && !identifier.test(settings.schema.closed))
  throw new Error("Invalid closed candle column.");
if (!["seconds", "milliseconds"].includes(settings.schema.timestampUnit))
  throw new Error("Invalid chart timestamp unit.");
if (settings.schema.timeframeValues &&
    ["H1", "M15", "M5"].some(tf => typeof settings.schema.timeframeValues[tf] !== "string" || !settings.schema.timeframeValues[tf]))
  throw new Error("All timeframe mappings must be nonempty strings.");
if (settings.schema.tickSize !== undefined &&
    (!Number.isFinite(settings.schema.tickSize) || settings.schema.tickSize <= 0))
  throw new Error("Tick size must be positive.");
const source = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
const chart = source.d1_databases.find(db => db.binding === "CHART_DB");
const application = source.d1_databases.find(db => db.binding === "DB");
if (!chart || !application) throw new Error("Missing CHART_DB or DB binding.");
source.name = environment === "production" ? source.name : `${source.name}-${environment}`;
source.account_id = settings.account;
source.main = resolve("src/server/index.ts");
source.assets.directory = resolve("dist");
source.workers_dev = true;
chart.database_id = settings.chart;
application.database_id = settings.application;
application.migrations_dir = resolve("migrations");
source.vars = {
  APP_ENV: environment,
  PUBLIC_ORIGIN: settings.origin,
  CHART_SCHEMA: JSON.stringify(settings.schema),
};
if (process.env.BYGA_R2_BUCKET)
  source.r2_buckets = [{ binding: "OFFICE_ASSETS", bucket_name: process.env.BYGA_R2_BUCKET }];
await mkdir(".wrangler", { recursive: true });
const path = `.wrangler/deploy-${environment}.json`;
await writeFile(path, JSON.stringify(source, null, 2) + "\n");
console.log(`Wrote ${path}; no credentials stored.`);
