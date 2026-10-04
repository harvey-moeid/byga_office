import { describe, expect, it, vi } from "vitest";
import {
  defaultCharacters,
  providers,
  type Provider,
} from "../src/core/contracts";
import {
  circuitResult,
  circuitState,
  defaultPolicy,
  parseOutput,
  requestAI,
  runCharacter,
  type AIRuntime,
  type Circuit,
} from "../src/server/providers";
import type { Env } from "../src/server/env";
const output = {
  vote: "BUY",
  confidence: 75,
  summary: "Evidence",
  reasoning: "Trend supports BUY",
  evidence: [
    { code: "DIRECTIONAL_BIAS", direction: "BUY", detail: "Trend up" },
  ],
  risk_flags: [],
};
const env = {
  OPENAI_API_KEY: "test-openai",
  GEMINI_API_KEY: "test-gemini",
  GROQ_API_KEY: "test-groq",
  OPENROUTER_API_KEY: "test-openrouter",
  MISTRAL_API_KEY: "test-mistral",
  HF_TOKEN: "test-hf",
  COHERE_API_KEY: "test-cohere",
  NVIDIA_API_KEY: "test-nvidia",
} as Env;
function response(provider: Provider, text = JSON.stringify(output)) {
  return provider === "gemini"
    ? {
        candidates: [{ content: { parts: [{ text }] } }],
        usageMetadata: { totalTokenCount: 32 },
      }
    : provider === "cohere"
      ? {
          message: { content: [{ text }] },
          usage: { tokens: { input_tokens: 20, output_tokens: 12 } },
        }
      : {
          choices: [{ message: { content: text } }],
          usage: { total_tokens: 32 },
        };
}
function runtime() {
  const circuits: Partial<Record<Provider, Circuit>> = {};
  const audit = vi.fn(async () => {});
  const r: AIRuntime = {
    getCircuit: async (p) => circuits[p] ?? { failures: 0, openedAt: 0 },
    setCircuit: async (p, c) => {
      circuits[p] = c;
    },
    audit,
    policy: async () => defaultPolicy,
    beforeCall: async () => {},
  };
  return { r, audit, circuits };
}
describe("Eight provider adapters", () => {
  it("retries invalid price relationships then falls back without rewriting the vote/confidence", async () => {
    const { r, audit } = runtime();
    const bad = {
      ...output,
      price_levels: { entry: 100, stop_loss: 101, take_profit: 102 },
    };
    const fetcher = vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            response(
              String(input).includes("googleapis") ? "gemini" : "openai",
              JSON.stringify(bad),
            ),
          ),
        ),
    ) as typeof fetch;
    const result = await runCharacter(
      env,
      defaultCharacters()[0],
      {},
      r,
      fetcher,
      async () => {},
    );
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(audit).toHaveBeenCalledTimes(4);
    expect(result.flags).toContain("SEMANTIC_VALIDATION_FAILED");
    expect(result.output?.vote).toBe("BUY");
    expect(result.output?.confidence).toBe(75);
    expect(result.validationErrors.join(" ")).toContain(
      "Price levels contradict vote",
    );
  });
  it.each(providers)("%s formats and parses its wire contract", async (p) => {
    const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toMatch(/^https:/);
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      if (p === "gemini") {
        expect(new Headers(init?.headers).get("x-goog-api-key")).toBe(
          "test-gemini",
        );
        expect(body.contents).toHaveLength(1);
      } else
        expect(new Headers(init?.headers).get("Authorization")).toMatch(
          /^Bearer test-/,
        );
      if (p === "openrouter") {
        expect(body.response_format.type).toBe("json_schema");
        expect(body.response_format.json_schema.strict).toBe(true);
        expect(body.provider.require_parameters).toBe(true);
      }
      return new Response(JSON.stringify(response(p)));
    }) as typeof fetch;
    const r = await requestAI(
      env,
      p,
      "fixture-model",
      "Locked context",
      defaultCharacters()[0],
      1000,
      f,
    );
    expect(parseOutput(r.text)).toEqual(output);
    expect(r.tokens).toBe(32);
  });
  it("parses fenced strict JSON and rejects extra invalid structure", () => {
    expect(parseOutput("```json\n" + JSON.stringify(output) + "\n```")).toEqual(
      output,
    );
    expect(() => parseOutput('{"vote":"HOLD"}')).toThrow();
  });
  it("falls back after primary retry; captures audit and normal vote", async () => {
    const { r, audit } = runtime();
    let calls = 0;
    const f = vi.fn(async () => {
      calls++;
      return calls <= 2
        ? new Response("rate limit", { status: 429 })
        : new Response(JSON.stringify(response("gemini")));
    }) as typeof fetch;
    const result = await runCharacter(
      env,
      defaultCharacters()[0],
      {},
      r,
      f,
      async () => {},
    );
    expect(calls).toBe(3);
    expect(audit).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("SUCCESS");
    expect(result.flags).toContain("MODEL_FALLBACK_USED");
  });
  it("returns UNAVAILABLE after four failed attempts", async () => {
    const { r } = runtime();
    const f = vi.fn(
      async () => new Response("", { status: 503 }),
    ) as typeof fetch;
    const result = await runCharacter(
      env,
      defaultCharacters()[0],
      {},
      r,
      f,
      async () => {},
    );
    expect(f).toHaveBeenCalledTimes(4);
    expect(result.status).toBe("UNAVAILABLE");
  });
  it("retains last structurally valid vote after persistent semantic errors", async () => {
    const { r } = runtime();
    const bad = {
      ...output,
      evidence: [
        { code: "DIRECTIONAL_BIAS", direction: "SELL", detail: "Opposing" },
      ],
    };
    const f = vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            response(
              String(input).includes("googleapis") ? "gemini" : "openai",
              JSON.stringify(bad),
            ),
          ),
        ),
    ) as typeof fetch;
    const result = await runCharacter(
      env,
      defaultCharacters()[0],
      {},
      r,
      f,
      async () => {},
    );
    expect(result.output?.vote).toBe("BUY");
    expect(result.flags).toContain("SEMANTIC_VALIDATION_FAILED");
  });
  it("skips open primary and uses fallback", async () => {
    const { r, circuits } = runtime();
    circuits.openrouter = { failures: 3, openedAt: Date.now() };
    const f = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("googleapis");
      return new Response(JSON.stringify(response("gemini")));
    }) as typeof fetch;
    expect(
      (
        await runCharacter(
          env,
          defaultCharacters()[0],
          {},
          r,
          f,
          async () => {},
        )
      ).flags,
    ).toContain("MODEL_FALLBACK_USED");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("circuit opens on 3rd failure, cools down, resets on success", () => {
    let c: Circuit = { failures: 0, openedAt: 0 };
    c = circuitResult(c, false, defaultPolicy, 1);
    c = circuitResult(c, false, defaultPolicy, 2);
    expect(circuitState(c, 3)).toBe("CLOSED");
    c = circuitResult(c, false, defaultPolicy, 3);
    expect(circuitState(c, 100)).toBe("OPEN");
    expect(circuitState(c, 300003)).toBe("HALF_OPEN");
    expect(circuitResult(c, true)).toEqual({ failures: 0, openedAt: 0 });
  });
});
