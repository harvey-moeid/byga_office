import { describe, expect, it, vi } from "vitest";
import {
  defaultCharacters,
  providers,
  workersAIModel,
  type Provider,
} from "../src/core/contracts";
import {
  circuitResult,
  circuitState,
  defaultPolicy,
  parseOutput,
  requestAI,
  renderPrompt,
  runCharacter,
  discoverModels,
  isProviderConfigured,
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
describe("Provider adapters", () => {
  it("falls back to the pinned Workers AI model when catalog discovery stalls", async () => {
    vi.useFakeTimers();
    try {
      const models = vi.fn(() => new Promise<never>(() => {}));
      const cloudflare = {
        ...env,
        AI: { run: vi.fn(), models } as unknown as Ai,
      };
      const pending = discoverModels(cloudflare, "workers-ai");
      await vi.advanceTimersByTimeAsync(10001);
      expect(await pending).toEqual([workersAIModel]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("uses the pinned Workers AI model when the runtime exposes no catalog method", async () => {
    const cloudflare = {
      ...env,
      AI: { run: vi.fn() } as unknown as Ai,
    };
    expect(await discoverModels(cloudflare, "workers-ai")).toEqual([
      workersAIModel,
    ]);
  });
  const binding = ({
    run = vi.fn(async () => ({
      response: output,
      usage: { prompt_tokens: 20, completion_tokens: 12 },
    })),
    models = vi.fn(async () => []),
  }: { run?: unknown; models?: unknown } = {}) => ({
    ...env,
    AI: { run, models } as unknown as Ai,
  });
  it.each([true, false])(
    "Workers AI handles JSON response objects and strings (%s)",
    async (object) => {
      const run = vi.fn(async () => ({
        response: object ? output : JSON.stringify(output),
        usage: { prompt_tokens: 20, completion_tokens: 12 },
      }));
      const cloudflare = binding({ run });
      const f = vi.fn() as unknown as typeof fetch;
      const result = await requestAI(
        cloudflare,
        "workers-ai",
        workersAIModel,
        "fixture prompt",
        defaultCharacters()[0],
        1000,
        f,
      );
      expect(parseOutput(result.text)).toEqual(output);
      expect(result.tokens).toBe(32);
      expect(run).toHaveBeenCalledWith(
        workersAIModel,
        expect.objectContaining({
          stream: false,
          response_format: expect.objectContaining({ type: "json_schema" }),
          max_tokens: 1500,
        }),
        { signal: expect.any(AbortSignal) },
      );
      expect(f).not.toHaveBeenCalled();
      expect(isProviderConfigured(cloudflare, "workers-ai")).toBe(true);
      expect(isProviderConfigured(env, "workers-ai")).toBe(false);
    },
  );
  it("Workers AI failure uses audited retries and configured external fallback", async () => {
    const cloudflare = binding({
      run: vi.fn(async () => {
        throw new Error("WORKERS_AI_UNAVAILABLE");
      }),
    });
    const { r, audit } = runtime();
    const f = vi.fn(
      async () => new Response(JSON.stringify(response("gemini"))),
    ) as typeof fetch;
    const result = await runCharacter(
      cloudflare,
      {
        ...defaultCharacters()[0],
        primary_provider: "workers-ai",
        primary_model: workersAIModel,
      },
      {},
      r,
      f,
      async () => {},
    );
    expect(result.status).toBe("SUCCESS");
    expect(result.provider).toBe("gemini");
    expect(result.flags).toContain("MODEL_FALLBACK_USED");
    expect(cloudflare.AI!.run).toHaveBeenCalledTimes(2);
    expect(audit).toHaveBeenCalledTimes(3);
  });
  it("discovers only text generation models and deduplicates catalog names", async () => {
    const models = vi.fn(async () => [
      { name: workersAIModel, task: { name: "Text Generation" } },
      { name: workersAIModel, task: { name: "Text Generation" } },
      { name: "@cf/image/model", task: { name: "Text-to-Image" } },
    ]);
    expect(
      await discoverModels(binding({ models }), "workers-ai"),
    ).toEqual([workersAIModel]);
    expect(models).toHaveBeenCalledWith({
      page: 1,
      per_page: 100,
      hide_experimental: true,
    });
    await expect(discoverModels(env, "workers-ai")).rejects.toThrow(
      "PROVIDER_NOT_CONFIGURED",
    );
  });
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
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.flags).toContain("SEMANTIC_VALIDATION_FAILED");
    expect(result.output).toBeUndefined();
    expect(result.validationErrors.join(" ")).toContain(
      "Price levels contradict vote",
    );
  });
  it.each(providers.filter((p) => p !== "workers-ai"))(
    "%s formats and parses its wire contract",
    async (p) => {
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
    },
  );
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
  it("never exposes a persistent semantic-invalid response as a voting output", async () => {
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
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.output).toBeUndefined();
    expect(result.flags).toContain("SEMANTIC_VALIDATION_FAILED");
  });
  it("rejects BUY/SELL without matching directional evidence after all retries", async () => {
    const { r } = runtime();
    const noDirectionalEvidence = {
      ...output,
      evidence: [
        {
          code: "TREND_CONTEXT",
          direction: "BUY",
          detail: "Not authoritative directional evidence",
        },
      ],
    };
    const f = vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            response(
              String(input).includes("googleapis") ? "gemini" : "openai",
              JSON.stringify(noDirectionalEvidence),
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
    expect(f).toHaveBeenCalledTimes(4);
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.output).toBeUndefined();
    expect(result.validationErrors.join(" ")).toContain(
      "requires matching DIRECTIONAL_BIAS evidence",
    );
  });
  it("renders role-specific rubrics with dedicated Risk and Boss authority", () => {
    for (const character of defaultCharacters()) {
      const prompt = renderPrompt(character, {});
      expect(prompt).toContain("Decision rubric:");
      expect(prompt).toContain(
        "BUY/SELL requires at least one evidence item with code DIRECTIONAL_BIAS",
      );
    }
    expect(
      renderPrompt(defaultCharacters().find((c) => c.id === "risk")!, {}),
    ).toContain("Risk Manager authority contract:");
    expect(
      renderPrompt(defaultCharacters().find((c) => c.id === "boss")!, {}),
    ).toContain("Boss authority contract:");
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
