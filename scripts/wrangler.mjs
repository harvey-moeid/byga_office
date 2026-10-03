import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
await mkdir(".wrangler/logs", { recursive: true });
const result = spawnSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: resolve(".wrangler/logs/wrangler.log"),
      WRANGLER_SEND_METRICS: "false",
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME ?? "/tmp/byga-xdg-config",
    },
  },
);
process.exitCode = result.status ?? 1;
