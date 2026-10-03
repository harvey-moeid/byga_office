import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const configPath = process.env.BYGA_DEPLOY_CONFIG;
if (!configPath) {
  console.error(
    "Set BYGA_DEPLOY_CONFIG to a real staging/production Wrangler JSON configuration. See docs/DEPLOYMENT.md.",
  );
  process.exit(1);
}
const config = JSON.parse(await readFile(configPath, "utf8"));
if (
  !["staging", "production"].includes(config.vars?.APP_ENV) ||
  config.d1_databases?.some(
    (db) => !db.database_id || db.database_id.startsWith("00000000"),
  ) ||
  !config.account_id ||
  !config.vars?.PUBLIC_ORIGIN?.startsWith("https://")
) {
  console.error(
    "Deployment blocked: real account, D1 bindings, HTTPS origin, and APP_ENV are required.",
  );
  process.exit(1);
}
const chart = config.d1_databases.find((db) => db.binding === "CHART_DB");
const application = config.d1_databases.find((db) => db.binding === "DB");
if (!chart || !application || chart.database_id === application.database_id) {
  console.error("Chart and application databases must be distinct.");
  process.exit(1);
}
const result = spawnSync(
  "node",
  ["scripts/wrangler.mjs", "deploy", "--config", configPath],
  { stdio: "inherit", env: process.env },
);
process.exitCode = result.status ?? 1;
