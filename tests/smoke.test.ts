import assert from "node:assert/strict";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analysisGroups,
  characterIds,
  defaultCharacters,
} from "../src/core/contracts";
import { meetingTurns } from "../src/core/meeting";
import { scannerMeeting } from "../src/core/scanner-meeting";

const aiMeeting = {
  case_id: "CASE-smoke-fixture",
  kind: "AI",
  ...meetingTurns([
    JSON.stringify({
      id: "trend",
      status: "SUCCESS",
      output: {
        vote: "NO_TRADE",
        confidence: 50,
        summary: "Fixture analysis summary",
        reasoning: "Fixture analysis reasoning",
        evidence: [],
        risk_flags: [],
      },
    }),
  ]),
};
const scanner = scannerMeeting({
  id: "SCANNER-smoke-fixture",
  scheduled_at: 1800000,
  candle_timestamp: 1500000,
  minimum: 2,
  direction: null,
  reason: "NO_CONSENSUS",
  groups: analysisGroups.map((group) => ({
    group,
    direction: "NONE",
    strength: 0,
    reasons: ["No confirmed direction"],
  })),
});

async function smoke(meeting: unknown, admin = false, providerFailure = false) {
  // Execute the real deployment script with local responses; never contact
  // production, create Admin sessions, or call any external AI provider.
  const responses: Record<string, unknown> = {
    "/api/v1/auth/session": { admin: false },
    "/api/v1/office/state": {
      office: "MONITORING",
      group_consensus_min: 2,
      group_names: analysisGroups,
      groups: [],
    },
    "/api/v1/office/meeting": { meeting },
    "/api/v1/characters": characterIds.map((id) => ({ id })),
    "/api/v1/health": { api: "OK", chart_db: "OK", ai_providers: "OK" },
    "/api/v1/market/status": {
      status: "OK",
      market: "BTCUSDT.P",
      development: false,
      timeframes: Object.fromEntries(
        ["H1", "M15", "M5"].map((tf) => [tf, Array(100).fill({})]),
      ),
    },
  };
  vi.resetModules();
  vi.stubEnv("BYGA_PUBLIC_ORIGIN", "https://smoke.fixture");
  vi.stubEnv("ADMIN_PASSWORD", admin ? "fixture-password" : undefined);
  let report: string | undefined;
  vi.spyOn(console, "log").mockImplementation((value: string) => {
    report = value;
  });
  let loggedOut = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, options?: RequestInit) => {
      const path = new URL(input).pathname;
      if (admin) {
        if (path === "/api/v1/auth/login")
          return Response.json(
            {},
            {
              headers: {
                "set-cookie":
                  "session=fixture; HttpOnly; Secure; SameSite=Strict",
              },
            },
          );
        if (path === "/api/v1/auth/logout") {
          loggedOut = true;
          return Response.json({});
        }
        if (path === "/api/v1/admin/config")
          return loggedOut || !new Headers(options?.headers).has("Cookie")
            ? new Response("", { status: 401 })
            : Response.json({ config: { scannerConsensusMin: 2 } });
        if (path === "/api/v1/admin/characters")
          return Response.json(defaultCharacters());
        if (path === "/api/v1/admin/health")
          return Response.json({
            configured: [
              { id: "openrouter", configured: true },
              { id: "gemini", configured: true },
              { id: "workers-ai", configured: true },
            ],
          });
        if (path === "/api/v1/admin/test-provider") {
          const { model } = JSON.parse(String(options?.body));
          return providerFailure
            ? Response.json({ error: "fixture-secret" }, { status: 503 })
            : Response.json({ ok: true, inference: "PASS", model });
        }
        if (path === "/api/v1/admin/scan")
          return new Response("", { status: 403 });
      }
      if (path === "/office")
        return new Response(
          '<div id="root"></div><script src="/assets/fixture.js"></script>',
          {
            headers: {
              "x-frame-options": "DENY",
              "content-security-policy": "frame-ancestors 'none'",
              "x-content-type-options": "nosniff",
            },
          },
        );
      if (path === "/assets/fixture.js")
        return new Response("// fixture", {
          headers: { "content-type": "application/javascript" },
        });
      if (path === "/api/v1/admin/config")
        return new Response("", { status: 401 });
      if (path === "/api/v1/__test/alarm")
        return new Response("", { status: 404 });
      if (!Object.hasOwn(responses, path))
        throw new Error("Unexpected smoke request: " + path);
      return Response.json(responses[path]);
    }),
  );
  const script = "../scripts/smoke.mjs";
  await import(script);
  return JSON.parse(report!);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("deployed meeting smoke acceptance", () => {
  it("verifies actual active provider routes through the full Admin smoke and logs out", async () => {
    const report = await smoke(null, true);
    expect(report.real_ai_inference).toBe("PASS");
    expect(report.admin_authentication).toBe("PASS");
    expect(report.active_provider_paths.paths).toHaveLength(10);
    const calls = vi.mocked(fetch).mock.calls;
    const probes = calls.filter(([url]) =>
      String(url).endsWith("/test-provider"),
    );
    expect(probes).toHaveLength(1);
    expect(JSON.parse(String(probes[0][1]?.body))).toEqual({
      id: "openrouter",
      model: defaultCharacters()[0].primary_model,
    });
    expect(calls.some(([url]) => String(url).endsWith("/auth/logout"))).toBe(
      true,
    );
  });

  it("fails initial smoke and still logs out when no deployed provider route works", async () => {
    await expect(smoke(null, true, true)).rejects.toThrow(
      "cron must remain disabled",
    );
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) => String(url).endsWith("/auth/logout")),
    ).toBe(true);
  });

  it.each([
    ["no active meeting", null],
    ["AI meeting", aiMeeting],
    ["legacy AI meeting without kind", { ...aiMeeting, kind: undefined }],
    ["scanner review with group, risk and boss narration", scanner],
    [
      "scanner review while market data is unavailable",
      scannerMeeting({
        ...scanner.scan!,
        groups: [],
        reason: "MARKET_UNAVAILABLE",
        candle_timestamp: null,
      }),
    ],
  ])("accepts %s", async (_label, meeting) => {
    expect((await smoke(meeting)).infrastructure).toBe("PASS");
  });

  it.each([
    ["missing AI analysis", { character: "trend" }],
    ["missing scanner narration", { character: "risk", source: "SCANNER" }],
    [
      "invalid scanner direction",
      {
        character: "boss",
        source: "SCANNER",
        scanner: { summary: "s", reasoning: "r", direction: "UNKNOWN" },
      },
    ],
    ["missing reasoning", { character: "trend", analysis: { summary: "s" } }],
    [
      "unknown character",
      { character: "unknown", analysis: { summary: "s", reasoning: "r" } },
    ],
    ["null turn", null],
  ])(
    "rejects %s with an assertion instead of an unchecked property access",
    async (_label, turn) => {
      await expect(
        smoke({ case_id: "CASE-invalid-fixture", turns: [turn] }),
      ).rejects.toThrow(assert.AssertionError);
    },
  );
});
