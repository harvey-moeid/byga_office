import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for real inference verification.");
await mkdir(".wrangler", { recursive: true });
const outfile = resolve(".wrangler/live-provider.mjs");
await build({ entryPoints: ["src/server/providers.ts"], outfile, bundle: true, platform: "node", format: "esm" });
const { discoverModels, requestAI, parseOutput } = await import(pathToFileURL(outfile).href);
const env = { OPENAI_API_KEY: process.env.OPENAI_API_KEY };
const model = process.env.BYGA_VERIFY_MODEL || "gpt-4.1-mini";
const models = await discoverModels(env, "openai");
assert.ok(models.includes(model), "Configured OpenAI model is not available to this account.");
const character = { id: "trend", temperature: 0, max_output_tokens: 200 };
const safeErrorCodes = new Set([
  "insufficient_quota", "billing_not_active", "billing_hard_limit_reached",
  "usage_limit_reached", "organization_spend_limit_exceeded",
  "organization_usage_limit_exceeded", "rate_limit_exceeded", "slow_down",
  "rate_limit_error", "invalid_api_key", "model_not_found",
]);
let calls = 0;
async function verifiedFetch(url, options) {
  for (let attempt = 0; attempt < 3; attempt++) {
    calls++;
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
    if (response.ok) return response;
    const payload = await response.clone().json().catch(() => ({}));
    // Only allowlisted codes enter logs. Never print response text, headers or credentials.
    const code = safeErrorCodes.has(payload.error?.code) ? payload.error.code : "unclassified";
    const type = safeErrorCodes.has(payload.error?.type) ? payload.error.type : "unclassified";
    console.error(JSON.stringify({ provider: "openai", http_status: response.status, code, type, attempt: attempt + 1 }));
    const transient = response.status === 429 && type !== "insufficient_quota" &&
      ["rate_limit_exceeded", "slow_down", "rate_limit_error"].some(value => value === code || value === type);
    if (!transient || attempt === 2)
      throw new Error(`OPENAI_HTTP_${response.status}:${code}:${type}`);
    const retryAfter = Number(response.headers.get("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 30)
      throw new Error("OPENAI_RATE_LIMIT_RETRY_AFTER_EXCEEDS_PROBE_BUDGET");
    await new Promise(resolve => setTimeout(resolve,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000 * (attempt + 1)));
  }
}
const response = await requestAI(env, "openai", model,
  "This is a synthetic connectivity and JSON schema test, not market analysis. Return vote BUY, confidence 0, summary Connectivity verified, reasoning Synthetic probe only, evidence [], risk_flags [CONNECTIVITY_TEST], price_levels null. Never claim real market evidence.",
  character, 30000, verifiedFetch);
const parsed = parseOutput(response.text);
assert.equal(parsed.vote, "BUY");
assert.ok(parsed.risk_flags.includes("CONNECTIVITY_TEST"));
console.log(JSON.stringify({
  provider: "openai", model, discovery: "PASS", structured_inference: "PASS",
  tokens: response.tokens, calls, trading_signal_published: false,
  fallback_and_full_pipeline: "NOT_TESTED",
}, null, 2));
