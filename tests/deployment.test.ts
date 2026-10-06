import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

const directories: string[] = [];
const defaults = JSON.parse(readFileSync("deployment/production.json", "utf8"));
function configure(overrides: Record<string, unknown> = {}, environment: Record<string, string> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "byga-config-test-"));
  directories.push(directory);
  mkdirSync(join(directory, "deployment"));
  writeFileSync(join(directory, "deployment/production.json"), JSON.stringify({ ...defaults, ...overrides }));
  writeFileSync(join(directory, "wrangler.jsonc"), readFileSync("wrangler.jsonc"));
  const result = spawnSync(process.execPath, [resolve("scripts/configure.mjs")], {
    cwd: directory, encoding: "utf8",
    env: { PATH: process.env.PATH, BYGA_ENV: "production", ...environment },
  });
  return { directory, result };
}
afterAll(() => directories.forEach(directory => rmSync(directory, { recursive: true, force: true })));
describe("production configuration guards", () => {
  it("maps real chart schema and migrates only the distinct application binding", () => {
    const { directory, result } = configure();
    expect(result.status).toBe(0);
    const config = JSON.parse(readFileSync(join(directory, ".wrangler/deploy-production.json"), "utf8"));
    expect(config.ai).toEqual({ binding: "AI" });
    expect(config.triggers.crons).toEqual(["*/5 * * * *"]);
    expect(config.vars.PUBLIC_ORIGIN).toBe("https://karyawanai.muidsoft.com");
    expect(config.routes).toEqual([{ pattern: "karyawanai.muidsoft.com", custom_domain: true }]);
    const chart = config.d1_databases.find((db: { binding: string }) => db.binding === "CHART_DB");
    const application = config.d1_databases.find((db: { binding: string }) => db.binding === "DB");
    expect(chart.database_id).toBe(defaults.chart_db_id);
    expect(chart.migrations_dir).toBeUndefined();
    expect(application.database_id).toBe(defaults.office_db_id);
    expect(application.migrations_dir).toBe(join(directory, "migrations"));
    expect(JSON.parse(config.vars.CHART_SCHEMA)).toMatchObject({
      timestamp: "open_time", timestampUnit: "milliseconds", closed: "is_closed",
    });
    expect(config.vars).not.toHaveProperty("OPENAI_API_KEY");
  });
  it("keeps test-only changes out of the production deploy trigger", () => {
    const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
    expect(workflow).toContain('- "src/**"');
    expect(workflow).not.toContain('- "tests/**"');
    expect(workflow).not.toContain('- "browser-tests/**"');
    expect(workflow).not.toContain('- "vitest.config.ts"');
    expect(workflow).not.toContain('- "playwright.config.ts"');
  });
  it("rejects migrations directed at the chart database", () => {
    const { result } = configure({ office_db_id: defaults.chart_db_id });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("distinct chart and application");
  });
  it.each(["http://example.com", "https://example.com/path", "https://user:password@example.com"])(
    "rejects unsafe origin %s", origin => {
      const { result } = configure({ public_origin: origin });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("exact HTTPS origin");
    },
  );
  it("rejects SQL identifiers before generating a remote configuration", () => {
    const { result } = configure({ chart_schema: { ...defaults.chart_schema, closed: "is_closed; DELETE FROM candles" } });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid closed candle column");
  });
});
