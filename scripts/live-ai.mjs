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
const response = await requestAI(env, "openai", model,
  "This is a synthetic connectivity and JSON schema test, not market analysis. Return vote BUY, confidence 0, summary Connectivity verified, reasoning Synthetic probe only, evidence [], risk_flags [CONNECTIVITY_TEST], price_levels null. Never claim real market evidence.",
  character, 30000);
const parsed = parseOutput(response.text);
assert.equal(parsed.vote, "BUY");
assert.ok(parsed.risk_flags.includes("CONNECTIVITY_TEST"));
console.log(JSON.stringify({
  provider: "openai", model, discovery: "PASS", structured_inference: "PASS",
  tokens: response.tokens, calls: 1, trading_signal_published: false,
  fallback_and_full_pipeline: "NOT_TESTED",
}, null, 2));
