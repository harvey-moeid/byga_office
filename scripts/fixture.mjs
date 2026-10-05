import { writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const now = Date.now();
const statements = [
  "CREATE TABLE IF NOT EXISTS candles(symbol TEXT NOT NULL,timeframe TEXT NOT NULL,timestamp INTEGER NOT NULL,open REAL NOT NULL,high REAL NOT NULL,low REAL NOT NULL,close REAL NOT NULL,volume REAL NOT NULL,PRIMARY KEY(symbol,timeframe,timestamp));",
];
for (const [tf, duration] of [
  ["H1", 3600000],
  ["M15", 900000],
  ["M5", 300000],
]) {
  const latest = Math.floor((now - duration - 5000) / duration) * duration;
  for (let i = 0; i < 600; i++) {
    const close = 60000 + Math.sin(i / 8) * 800 + i * 2;
    statements.push(
      `INSERT OR REPLACE INTO candles VALUES ('BTCUSDT','${tf}',${Math.floor((latest - (599 - i) * duration) / 1000)},${close - 30},${close + 100},${close - 100},${close},${100 + (i % 7)});`,
    );
  }
}
await mkdir(".wrangler/fixture", { recursive: true });
await writeFile(".wrangler/fixture/market.sql", statements.join("\n"));
const result = spawnSync(
  "node",
  [
    "scripts/wrangler.mjs",
    "d1",
    "execute",
    "chart_db",
    "--local",
    "--file",
    ".wrangler/fixture/market.sql",
  ],
  { stdio: ["inherit", "pipe", "inherit"], env: process.env },
);
if (result.status === 0)
  console.log(
    "Seeded 1800 synthetic local candles; no remote database accessed.",
  );
else if (result.stdout) process.stderr.write(result.stdout);
process.exitCode = result.status ?? 1;
