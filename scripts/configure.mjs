import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const required = [
  "BYGA_ENV",
  "CLOUDFLARE_ACCOUNT_ID",
  "BYGA_CHART_DB_ID",
  "BYGA_OFFICE_DB_ID",
  "BYGA_PUBLIC_ORIGIN",
  "BYGA_CHART_SCHEMA",
];
for (const name of required)
  if (!process.env[name]) {
    console.error(`Missing ${name}. See docs/DEPLOYMENT.md.`);
    process.exit(1);
  }
if (!["staging", "production"].includes(process.env.BYGA_ENV)) {
  console.error("BYGA_ENV must be staging or production.");
  process.exit(1);
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (
  !uuid.test(process.env.BYGA_CHART_DB_ID) ||
  !uuid.test(process.env.BYGA_OFFICE_DB_ID) ||
  process.env.BYGA_CHART_DB_ID === process.env.BYGA_OFFICE_DB_ID ||
  process.env.BYGA_OFFICE_DB_ID.startsWith("00000000")
) {
  console.error(
    "Real, distinct chart and application D1 IDs are required; application migrations must never target chart_db.",
  );
  process.exit(1);
}
const source = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
const schema = JSON.parse(process.env.BYGA_CHART_SCHEMA);
source.name = `byga-trading-office-${process.env.BYGA_ENV}`;
source.account_id = process.env.CLOUDFLARE_ACCOUNT_ID;
source.main = resolve("src/server/index.ts");
source.assets.directory = resolve("dist");
source.d1_databases[0].database_id = process.env.BYGA_CHART_DB_ID;
source.d1_databases[1].database_id = process.env.BYGA_OFFICE_DB_ID;
source.d1_databases[1].migrations_dir = resolve("migrations");
source.vars = {
  APP_ENV: process.env.BYGA_ENV,
  PUBLIC_ORIGIN: process.env.BYGA_PUBLIC_ORIGIN,
  CHART_SCHEMA: JSON.stringify(schema),
};
if (process.env.BYGA_R2_BUCKET)
  source.r2_buckets = [
    { binding: "OFFICE_ASSETS", bucket_name: process.env.BYGA_R2_BUCKET },
  ];
await mkdir(".wrangler", { recursive: true });
const path = `.wrangler/deploy-${process.env.BYGA_ENV}.json`;
await writeFile(path, JSON.stringify(source, null, 2) + "\n");
console.log(`Wrote ${path}; no credentials stored.`);
