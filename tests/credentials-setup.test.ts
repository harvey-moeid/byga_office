import { afterAll, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const directories: string[] = [];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "byga-credential-setup-"));
  directories.push(directory);
  return directory;
}
function run(
  directory: string,
  args: string[] = [],
  extra: Record<string, string> = {},
) {
  return spawnSync(
    process.execPath,
    [resolve("scripts/credentials-key.mjs"), ...args],
    {
      cwd: directory,
      encoding: "utf8",
      env: { PATH: process.env.PATH, ...extra },
    },
  );
}
function remote(mode: string) {
  const directory = fixture();
  mkdirSync(join(directory, "scripts"));
  writeFileSync(
    join(directory, "config.json"),
    JSON.stringify({
      account_id: "fixture",
      vars: { APP_ENV: "production", PUBLIC_ORIGIN: "https://fixture.invalid" },
    }),
  );
  // Emulate only Wrangler secret inventory/put. No credentials or network calls.
  writeFileSync(
    join(directory, "scripts/wrangler.mjs"),
    `import { writeFileSync } from 'node:fs';
if (process.argv[3] === 'list') {
  if (process.env.FIXTURE_MODE === 'inventory-fails') process.exit(1);
  console.log(JSON.stringify(process.env.FIXTURE_MODE === 'existing' ? [{ name: 'PROVIDER_KEYS_ENCRYPTION_KEY' }] : []));
} else if (process.argv[3] === 'put') {
  let root = ''; for await (const part of process.stdin) root += part;
  writeFileSync('put.json', JSON.stringify({ name: process.argv[4], root: root.trim() }));
  if (process.env.FIXTURE_MODE === 'put-fails') { console.error(root); process.exit(1); }
}`,
  );
  return {
    directory,
    result: run(directory, ["--config", "config.json"], { FIXTURE_MODE: mode }),
  };
}
afterAll(() =>
  directories.forEach((directory) =>
    rmSync(directory, { recursive: true, force: true }),
  ),
);
describe("Credential root initialization", () => {
  it("initializes a local root without printing it or modifying other secrets, and preserves it on rerun", () => {
    const directory = fixture();
    writeFileSync(
      join(directory, ".dev.vars"),
      "ADMIN_PASSWORD_HASH=fixture-unchanged\nPROVIDER_KEYS_ENCRYPTION_KEY=\n",
    );
    const first = run(directory);
    expect(first.status).toBe(0);
    const content = readFileSync(join(directory, ".dev.vars"), "utf8");
    const root = content.match(
      /PROVIDER_KEYS_ENCRYPTION_KEY=([a-f0-9]{64})/,
    )![1];
    expect(content).toContain("ADMIN_PASSWORD_HASH=fixture-unchanged");
    expect(first.stdout + first.stderr).not.toContain(root);
    expect(statSync(join(directory, ".dev.vars")).mode & 0o777).toBe(0o600);
    expect(run(directory).status).toBe(0);
    expect(readFileSync(join(directory, ".dev.vars"), "utf8")).toBe(content);
  });
  it("refuses to replace an invalid existing local root", () => {
    const directory = fixture();
    const content = "PROVIDER_KEYS_ENCRYPTION_KEY=invalid-existing-root\n";
    writeFileSync(join(directory, ".dev.vars"), content);
    expect(run(directory).status).not.toBe(0);
    expect(readFileSync(join(directory, ".dev.vars"), "utf8")).toBe(content);
  });
  it("preserves an existing Worker root and initializes only the absent secret", () => {
    const existing = remote("existing");
    expect(existing.result.status).toBe(0);
    expect(existsSync(join(existing.directory, "put.json"))).toBe(false);
    const created = remote("absent");
    expect(created.result.status).toBe(0);
    const stored = JSON.parse(
      readFileSync(join(created.directory, "put.json"), "utf8"),
    );
    expect(stored.name).toBe("PROVIDER_KEYS_ENCRYPTION_KEY");
    expect(stored.root).toMatch(/^[a-f0-9]{64}$/);
    expect(created.result.stdout + created.result.stderr).not.toContain(
      stored.root,
    );
  });
  it("does not invent readiness or leak a generated root when Wrangler fails", () => {
    const inventory = remote("inventory-fails");
    expect(inventory.result.status).not.toBe(0);
    expect(existsSync(join(inventory.directory, "put.json"))).toBe(false);
    const put = remote("put-fails");
    expect(put.result.status).not.toBe(0);
    const stored = JSON.parse(
      readFileSync(join(put.directory, "put.json"), "utf8"),
    );
    expect(put.result.stdout + put.result.stderr).not.toContain(stored.root);
  });
});
