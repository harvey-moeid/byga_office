import { test, expect } from "@playwright/test";
import {
  caseParticipants,
  defaultConfig,
  defaultCharacters,
} from "../src/core/contracts";

test("compact AI meetings show four voters while inactive analysts keep monitoring", async ({
  page,
}) => {
  const participants = caseParticipants({ aiVoterCount: 4 });
  const analysis = {
    vote: "BUY",
    confidence: 70,
    summary: "Compact fixture output",
    reasoning: "Stored fixture analysis",
    evidence: [],
    risk_flags: [],
    price_levels: null,
  };
  await page.addInitScript(() => {
    class QuietEvents extends EventTarget {
      close() {}
    }
    Object.assign(window, { EventSource: QuietEvents });
    HTMLCanvasElement.prototype.getContext = (() =>
      null) as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    const json =
      path === "/office/meeting"
        ? {
            meeting: {
              case_id: "CASE-four-voters",
              kind: "AI",
              status: "COMPLETED",
              finished: true,
              cancelled: false,
              participants,
              turns: participants.map((character) => ({ character, analysis })),
              unavailable: [],
            },
          }
        : path === "/office/state"
          ? {
              office: "AI_ANALYSIS",
              observed_at: Date.now(),
              scanners: [],
              groups: [],
              ai_voter_count: 4,
              active: {
                id: "CASE-four-voters",
                status: "AI_ANALYSIS",
                participants,
              },
            }
          : path === "/auth/session"
            ? { admin: false }
            : path === "/characters"
              ? defaultCharacters().map(({ id, avatar }) => ({ id, avatar }))
              : path === "/health"
                ? { api: "OK" }
                : path === "/market/status"
                  ? {
                      price: 100,
                      tickSize: 0.01,
                      timeframes: { H1: [], M15: [], M5: [] },
                    }
                  : path === "/admin/config"
                    ? { config: defaultConfig }
                    : [];
    await route.fulfill({ json });
  });
  await page.goto("/operations");
  await expect(page.locator(".meeting-status-case")).toContainText(
    "4 AI voting + Risk/Boss",
  );
  await expect(
    page.getByText("Voting case baru: 4 AI + Risk/Boss", { exact: true }),
  ).toBeVisible();
  const team = page.getByLabel("Tim operasi", { exact: true });
  for (const name of [
    "Momentum Analyst",
    "Liquidity Analyst",
    "Quant Analyst",
    "Market Positioning Analyst",
  ]) {
    await expect(
      team.getByRole("button", { name: new RegExp(name) }),
    ).toContainText("MONITORING");
  }
  await expect(
    team.getByRole("button", { name: /Structure Analyst/ }),
  ).toContainText("WALKING TO MEETING");
  await expect(team.getByRole("button", { name: /Head Trader/ })).toContainText(
    "WAITING IN OFFICE",
  );
});
