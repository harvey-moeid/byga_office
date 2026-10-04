import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
const env = {
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
};
for (const [key, value] of Object.entries(env))
  if (!value) throw new Error(key + " is required for real inference verification.");
await mkdir(".wrangler", { recursive: true });
const outfile = resolve(".wrangler/live-provider.mjs");
await build({
  stdin: {
    contents: 'export { discoverModels, requestAI, parseOutput } from "./src/server/providers"; export { defaultCharacters } from "./src/core/contracts";',
    resolveDir: process.cwd(), sourcefile: "live-provider-entry.ts", loader: "ts",
  },
  outfile, bundle: true, platform: "node", format: "esm",
});
const { discoverModels, requestAI, parseOutput, defaultCharacters } = await import(pathToFileURL(outfile).href);
const defaults = defaultCharacters()[0];
const safeErrorCodes = new Set([
  "insufficient_quota", "credit_balance_exhausted", "billing_not_active",
  "billing_hard_limit_reached", "usage_limit_reached", "project_spend_limit_exceeded",
  "organization_spend_limit_exceeded", "organization_usage_limit_exceeded",
  "rate_limit_exceeded", "slow_down", "rate_limit_error", "invalid_api_key", "model_not_found",
  "INVALID_ARGUMENT", "UNAUTHENTICATED", "PERMISSION_DENIED", "NOT_FOUND",
  "RESOURCE_EXHAUSTED", "UNAVAILABLE", "DEADLINE_EXCEEDED",
  400, 401, 402, 403, 408, 429, 500, 502, 503,
]);
const reports = [];
for (const [role, provider, model] of [
  ["primary", defaults.primary_provider, defaults.primary_model],
  ["fallback", defaults.fallback_provider, defaults.fallback_model],
]) {
  assert.ok(["openrouter", "gemini"].includes(provider), "Unexpected production provider selection.");
  const models = await discoverModels(env, provider);
  assert.ok(models.some(id => id.replace(/^models\//, "") === model),
    "Configured " + provider + " model is not available to this account.");
  let calls = 0;
  async function verifiedFetch(url, options) {
    for (let attempt = 0; attempt < 3; attempt++) {
      calls++;
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
      if (response.ok) return response;
      const payload = await response.clone().json().catch(() => ({}));
      const rawCode = payload?.error?.code;
      const rawType = payload?.error?.type ?? payload?.error?.status;
      // Never print response messages, headers or credentials.
      const code = safeErrorCodes.has(rawCode) ? rawCode : "unclassified";
      const type = safeErrorCodes.has(rawType) ? rawType : "unclassified";
      console.error(JSON.stringify({ provider, http_status: response.status, code, type, attempt: attempt + 1 }));
      const transient = response.status === 429 && type !== "insufficient_quota" &&
        ["rate_limit_exceeded", "slow_down", "rate_limit_error"].some(value => value === code || value === type);
      if (!transient || attempt === 2)
        throw new Error(provider.toUpperCase() + "_HTTP_" + response.status + ":" + code + ":" + type);
      const retryAfter = Number(response.headers.get("retry-after"));
      if (Number.isFinite(retryAfter) && retryAfter > 30)
        throw new Error("PROVIDER_RATE_LIMIT_RETRY_AFTER_EXCEEDS_PROBE_BUDGET");
      await new Promise(resolve => setTimeout(resolve,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000 * (attempt + 1)));
    }
  }
  const character = { ...defaults, temperature: 0, max_output_tokens: provider === "gemini" ? 1500 : 250 };
  const response = await requestAI(env, provider, model,
    "This is a synthetic connectivity and JSON schema test, not market analysis. Return vote BUY, confidence 0, summary Connectivity verified, reasoning Synthetic probe only, evidence [], risk_flags [CONNECTIVITY_TEST], price_levels null. Never claim real market evidence.",
    character, 30000, verifiedFetch);
  const parsed = parseOutput(response.text);
  assert.equal(parsed.vote, "BUY");
  assert.ok(parsed.risk_flags.includes("CONNECTIVITY_TEST"));
  reports.push({ role, provider, model, discovery: "PASS", structured_inference: "PASS", tokens: response.tokens, calls });
}
console.log(JSON.stringify({
  providers: reports, trading_signal_published: false,
  failover_and_full_pipeline: "NOT_TESTED",
}, null, 2));
