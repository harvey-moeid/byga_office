import { afterEach, describe, expect, it, vi } from "vitest";

const script = "../scripts/provider-smoke.mjs";
const { verifyProviderPaths, probeDeployedProvider } = await import(script);
const character = {
  id: "trend",
  primary_provider: "openrouter",
  primary_model: "primary-model",
  fallback_provider: "gemini",
  fallback_model: "fallback-model",
};
const configured = new Map([
  ["openrouter", true],
  ["gemini", true],
  ["workers-ai", true],
]);
const origin = "https://smoke.fixture";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("deployed active provider verification", () => {
  it("probes saved primary models once without calling unused Workers AI or fallback", async () => {
    const probe = vi.fn(async () => ({ status: "PASS" }));
    const result = await verifyProviderPaths(
      [character, { ...character, id: "boss" }],
      configured,
      probe,
    );
    expect(probe.mock.calls).toEqual([["openrouter", "primary-model"]]);
    expect(result).toMatchObject({ status: "PASS", degraded: false });
    expect(result.paths).toHaveLength(2);
    expect(
      result.paths.every((path: { role: string }) => path.role === "primary"),
    ).toBe(true);
  });

  it("accepts Workers AI quota exhaustion only with a working fallback for each character", async () => {
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      const { id, model } = JSON.parse(String(options.body));
      if (id === "workers-ai")
        return Response.json(
          { error: "4006: daily allocation exhausted fixture-secret" },
          { status: 503 },
        );
      return Response.json({ ok: true, inference: "PASS", model });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await verifyProviderPaths(
      [
        { ...character, primary_provider: "workers-ai" },
        { ...character, id: "boss", primary_provider: "workers-ai" },
      ],
      configured,
      (provider: string, model: string) =>
        probeDeployedProvider(origin, "session=fixture", provider, model),
    );
    expect(result).toMatchObject({ status: "PASS", degraded: true });
    expect(result.probes[0].reason).toBe("DAILY_QUOTA_EXHAUSTED");
    expect(
      result.paths.every((path: { role: string }) => path.role === "fallback"),
    ).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      method: "POST",
      headers: { Cookie: "session=fixture", Origin: origin },
      body: JSON.stringify({ id: "gemini", model: "fallback-model" }),
    });
  });

  it("skips unconfigured credentials and verifies configured fallback", async () => {
    const probe = vi.fn(async () => ({ status: "PASS" }));
    const result = await verifyProviderPaths(
      [character],
      new Map([["gemini", true]]),
      probe,
    );
    expect(probe.mock.calls).toEqual([["gemini", "fallback-model"]]);
    expect(result.paths[0].role).toBe("fallback");
  });

  it("checks different models independently and blocks when any character has no working route", async () => {
    const probe = vi.fn(async (_provider: string, model: string) => ({
      status: model === "primary-model" ? "PASS" : "UNAVAILABLE",
    }));
    await expect(
      verifyProviderPaths(
        [character, { ...character, id: "boss", primary_model: "other-model" }],
        configured,
        probe,
      ),
    ).rejects.toThrow("Active character boss has no working provider path");
    expect(probe.mock.calls).toEqual([
      ["openrouter", "primary-model"],
      ["openrouter", "other-model"],
      ["gemini", "fallback-model"],
    ]);
  });

  it("blocks quota exhaustion with no working alternative and rejects an empty roster", async () => {
    const probe = vi.fn(async () => ({ status: "UNAVAILABLE" }));
    await expect(
      verifyProviderPaths([character], configured, probe),
    ).rejects.toThrow("cron must remain disabled");
    await expect(verifyProviderPaths([], configured, probe)).rejects.toThrow(
      "configuration is empty",
    );
  });

  it.each([401, 403, 404, 409, 500])(
    "does not hide HTTP %s behind a fallback",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("fixture-secret", { status })),
      );
      await expect(
        probeDeployedProvider(origin, "fixture", "openrouter", "model"),
      ).rejects.toThrow(`HTTP ${status}`);
    },
  );

  it.each([
    { ok: true, inference: "NOT_TESTED", model: "model" },
    { ok: true, inference: "PASS", model: "wrong-model" },
    { ok: false, inference: "PASS", model: "model" },
    null,
  ])("rejects invalid inference acceptance %j", async (body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(body)),
    );
    await expect(
      probeDeployedProvider(origin, "fixture", "openrouter", "model"),
    ).rejects.toThrow("must verify structured inference");
  });

  it("sanitizes transport failures so a verified fallback can be attempted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fixture-secret");
      }),
    );
    expect(
      await probeDeployedProvider(origin, "fixture", "openrouter", "model"),
    ).toEqual({ status: "UNAVAILABLE", reason: "TRANSPORT_ERROR" });
  });
});
