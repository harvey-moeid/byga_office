import { describe, expect, it, vi } from "vitest";

const script = "../scripts/production-check.mjs";
const { assessHealth, checkProduction } = await import(script);
const healthy = {
  api: "OK",
  chart_db: "OK",
  ai_providers: "OK",
  discord: "CONFIGURED",
};

describe("read-only production readiness check", () => {
  it("never treats a healthy snapshot as pipeline or Discord delivery acceptance", () => {
    expect(assessHealth(healthy)).toMatchObject({
      runtime_health: "PASS",
      full_case_pipeline: "NOT_ASSESSED",
      real_discord_delivery: "NOT_ASSESSED",
    });
    for (const health of [
      null,
      {},
      { ...healthy, chart_db: "DEGRADED" },
      { ...healthy, ai_providers: "DEGRADED" },
      { ...healthy, discord: "NOT_CONFIGURED" },
    ])
      expect(assessHealth(health).runtime_health).toBe("FAIL");
  });
  it("retries transient degradation with only bounded anonymous health reads", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ...healthy, chart_db: "DEGRADED" }),
      )
      .mockResolvedValueOnce(Response.json(healthy));
    const sleep = vi.fn(async () => {});
    expect(
      (await checkProduction("https://production.fixture", fetcher, sleep))
        .runtime_health,
    ).toBe("PASS");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
    for (const [url, options] of fetcher.mock.calls) {
      expect(url).toBe("https://production.fixture/api/v1/health");
      expect(options).toMatchObject({
        redirect: "error",
        headers: { Accept: "application/json" },
      });
      expect(options).not.toHaveProperty("body");
    }
  });
  it("bounds failures and redacts untrusted response bodies", async () => {
    const fetcher = vi.fn(
      async () => new Response("fixture-secret".repeat(1000)),
    );
    const result = await checkProduction(
      "https://production.fixture",
      fetcher,
      async () => {},
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      runtime_health: "FAIL",
      error: "HEALTH_UNAVAILABLE",
    });
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
  });
  it.each([
    "http://production.fixture",
    "https://production.fixture/path",
    "https://user:password@production.fixture",
  ])("rejects unsafe origin %s before network access", async (origin) => {
    const fetcher = vi.fn();
    await expect(checkProduction(origin, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
