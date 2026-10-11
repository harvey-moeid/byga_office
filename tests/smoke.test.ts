import assert from "node:assert/strict";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analysisGroups, characterIds } from "../src/core/contracts";
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

async function smoke(meeting: unknown) {
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
  vi.stubEnv("ADMIN_PASSWORD", undefined);
  let report: string | undefined;
  vi.spyOn(console, "log").mockImplementation((value: string) => {
    report = value;
  });
  vi.stubGlobal("fetch", async (input: string) => {
    const path = new URL(input).pathname;
    if (path === "/office")
      return new Response(
        '<div id="root"></div><script src="/assets/fixture.js"></script>',
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
  });
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
