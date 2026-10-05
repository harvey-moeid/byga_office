import assert from "node:assert/strict";
const origin = process.env.BYGA_PUBLIC_ORIGIN;
if (!origin || new URL(origin).origin !== origin || !origin.startsWith("https://"))
  throw new Error("BYGA_PUBLIC_ORIGIN must be an exact HTTPS origin.");
async function get(path, status = 200) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(20000) });
    if (response.status === status) return response;
    // Fresh Worker/DO deployments can briefly return 5xx while propagating.
    // Retry safe reads only; persistent failures still block cron activation.
    if (status !== 200 || ![500, 502, 503, 504].includes(response.status) || attempt === 4)
      assert.equal(response.status, status, `${path}: unexpected HTTP status`);
    await response.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, 2000 * 2 ** attempt));
  }
}
const html = await (await get("/office")).text();
assert.match(html, /<div[^>]*id="root"/, "Frontend shell missing");
const asset = html.match(/src="([^"]+\.js)"/)?.[1];
assert.ok(asset?.startsWith("/assets/"), "Built frontend entry missing");
const script = await get(asset);
assert.match(script.headers.get("content-type") ?? "", /javascript/, "Static JS serving failed");
const session = await (await get("/api/v1/auth/session")).json();
assert.equal(session.admin, false);
await get("/api/v1/admin/config", 401);
await get("/api/v1/__test/alarm", 404);
const state = await (await get("/api/v1/office/state")).json();
const meeting = await (await get("/api/v1/office/meeting")).json();
assert.ok(Object.hasOwn(meeting, "meeting"), "Meeting presentation endpoint missing");
if (meeting.meeting) {
  assert.equal(typeof meeting.meeting.case_id, "string");
  assert.ok(Array.isArray(meeting.meeting.turns));
  assert.ok(meeting.meeting.turns.every(turn =>
    ["trend", "structure", "momentum", "liquidity", "volume", "quant", "risk", "boss"].includes(turn.character) &&
    typeof turn.analysis.summary === "string" && typeof turn.analysis.reasoning === "string"));
}
assert.equal(typeof state.office, "string", "Durable Object state missing");
assert.ok(
  Number.isInteger(state.group_consensus_min) &&
    state.group_consensus_min >= 1 && state.group_consensus_min <= 3,
  "Deployed backend must expose the deterministic group consensus minimum",
);
assert.deepEqual(
  state.group_names,
  ["SMC_ICT", "INDICATORS", "VOLUME"],
  "Deployed backend must expose all three deterministic analysis groups",
);
assert.ok(Array.isArray(state.groups), "Latest deterministic group snapshots must be an array");
const characters = await (await get("/api/v1/characters")).json();
assert.equal(characters.length, 8);
assert.ok(characters.every(c => !("primary_provider" in c) && !("primary_model" in c)));
const health = await (await get("/api/v1/health")).json();
assert.equal(health.api, "OK");
assert.equal(health.chart_db, "OK", "Deployed chart binding or freshness failed");
assert.notEqual(health.ai_providers, "DOWN", "Runtime provider secret missing");
const market = await (await get("/api/v1/market/status")).json();
assert.equal(market.status, "OK");
assert.equal(market.market, "BTCUSDT.P");
assert.equal(market.development, false, "Production must use real candles");
for (const tf of ["H1", "M15", "M5"]) assert.equal(market.timeframes[tf].length, 100);
let adminAuthentication = "NOT_TESTED";
if (process.env.ADMIN_PASSWORD) {
  const login = await fetch(origin + "/api/v1/auth/login", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(login.status, 200, "Deployed Admin login failed");
  const header = login.headers.get("set-cookie") ?? "";
  for (const flag of ["HttpOnly", "Secure", "SameSite=Strict"]) assert.ok(header.includes(flag));
  const cookie = header.split(";")[0];
  try {
    const config = await fetch(origin + "/api/v1/admin/config", {
      headers: { Cookie: cookie }, signal: AbortSignal.timeout(20000),
    });
    assert.equal(config.status, 200);
    const activeConfig = await config.json();
    const aiProbe = await fetch(origin + "/api/v1/admin/test-provider", {
      method: "POST",
      headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "workers-ai" }),
      signal: AbortSignal.timeout(30000),
    });
    const aiProbeBody = await aiProbe.text();
    assert.equal(
      aiProbe.status,
      200,
      `Deployed Workers AI binding/model probe failed: ${aiProbeBody.slice(0, 500)}`,
    );
    assert.equal(JSON.parse(aiProbeBody).inference, "PASS");
    assert.equal(
      activeConfig.config.scannerConsensusMin, state.group_consensus_min,
      "Admin config and Operations must agree on the Group Consensus minimum",
    );
    const rejected = await fetch(origin + "/api/v1/admin/scan", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://invalid-origin.example", "Content-Type": "application/json" },
      body: "{}", signal: AbortSignal.timeout(20000),
    });
    assert.equal(rejected.status, 403, "Wrong-origin mutation must be rejected");
  } finally {
    const logout = await fetch(origin + "/api/v1/auth/logout", {
      method: "POST", headers: { Cookie: cookie, Origin: origin },
      signal: AbortSignal.timeout(20000),
    });
    assert.equal(logout.status, 200);
    const expired = await fetch(origin + "/api/v1/admin/config", {
      headers: { Cookie: cookie }, signal: AbortSignal.timeout(20000),
    });
    assert.equal(expired.status, 401, "Logout must invalidate the session");
  }
  adminAuthentication = "PASS";
}
console.log(JSON.stringify({
  origin, infrastructure: "PASS", frontend: "PASS", durable_object: "PASS",
  admin_access_control: "PASS", admin_authentication: adminAuthentication, market: "PASS", provider_configuration: health.ai_providers,
  discord_configuration: health.discord,
  real_ai_inference: "NOT_TESTED", real_discord_delivery: "NOT_TESTED",
}, null, 2));
