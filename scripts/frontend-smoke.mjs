import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const origin = process.env.BYGA_PUBLIC_ORIGIN;
assert.ok(
  origin && new URL(origin).origin === origin && origin.startsWith("https://"),
  "BYGA_PUBLIC_ORIGIN must be an exact HTTPS origin.",
);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function get(path, status = 200) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(origin + path, {
      signal: AbortSignal.timeout(20000),
    });
    if (response.status === status) return response;
    if (
      status !== 200 ||
      ![500, 502, 503, 504].includes(response.status) ||
      attempt === 4
    )
      assert.equal(response.status, status, `${path}: unexpected HTTP status`);
    await response.body?.cancel();
    await wait(2000 * 2 ** attempt);
  }
}
const localHtml = await readFile("dist/index.html", "utf8");
const entry = localHtml.match(/src="([^"]+\.js)"/)?.[1];
assert.ok(entry?.startsWith("/assets/"), "Built frontend entry missing");
for (const path of ["/", "/office", "/operations"]) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const html = await (await get(path)).text();
    if (html.includes(entry)) break;
    assert.ok(
      attempt < 4,
      `${path}: production still serves a different frontend revision`,
    );
    await wait(2000 * 2 ** attempt);
  }
}
let checked = 0;
for (const name of await readdir("dist/assets")) {
  if (!/\.(?:js|css)$/.test(name)) continue;
  const local = await readFile("dist/assets/" + name);
  const response = await get("/assets/" + encodeURIComponent(name));
  assert.match(
    response.headers.get("content-type") ?? "",
    name.endsWith(".js") ? /javascript/ : /css/,
  );
  const deployed = Buffer.from(await response.arrayBuffer());
  assert.equal(
    digest(deployed),
    digest(local),
    `Production asset differs: ${name}`,
  );
  checked++;
}
assert.ok(checked >= 3, "Expected frontend and lazy scene assets");
const session = await (await get("/api/v1/auth/session")).json();
assert.equal(session.admin, false);
await get("/api/v1/admin/config", 401);
await get("/api/v1/__test/alarm", 404);
const state = await (await get("/api/v1/office/state")).json();
assert.equal(typeof state.office, "string");
const characters = await (await get("/api/v1/characters")).json();
assert.equal(characters.length, 8);
const health = await (await get("/api/v1/health")).json();
assert.equal(health.api, "OK");
console.log(
  JSON.stringify({
    frontend: "PASS",
    assets_verified: checked,
    deployed_entry: entry,
    api: "PASS",
    chart_db_observed: health.chart_db,
    market_error_observed: state.error ?? null,
    scope:
      "Frontend publication; real market/AI/Discord acceptance remains separate.",
  }),
);
