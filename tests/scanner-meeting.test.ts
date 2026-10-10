import { describe, expect, it } from "vitest";
import { analysisGroups } from "../src/core/contracts";
import {
  scannerMeeting,
  scannerReviewSummary,
  type ScannerReview,
} from "../src/core/scanner-meeting";
import { advanceMeeting, holdMeeting } from "../src/ui/meeting";
import { characterPresence } from "../src/ui/character-state";

const review: ScannerReview = {
  id: "SCANNER-1800000",
  scheduled_at: 1800000,
  candle_timestamp: 1500000,
  minimum: 2,
  direction: null,
  reason: "DIRECTION_CONFLICT",
  groups: analysisGroups.map((group, i) => ({
    group,
    direction: i < 2 ? "BUY" : "SELL",
    strength: 68,
    reasons: [`Actual ${group} evidence`],
  })),
};
describe("scheduled scanner presentation", () => {
  it("explains conflicting groups using actual scanner evidence without invented AI outputs", () => {
    const meeting = scannerMeeting(review);
    expect(scannerReviewSummary(review)).toContain("2 BUY, 2 SELL");
    expect(scannerReviewSummary(review)).toContain("tanpa memanggil AI");
    expect(meeting.turns.map((t) => t.character)).toEqual([
      "structure",
      "trend",
      "volume",
      "derivatives",
      "risk",
      "boss",
    ]);
    for (const turn of meeting.turns) {
      expect(turn).not.toHaveProperty("analysis");
      expect(turn).toHaveProperty("source", "SCANNER");
    }
    const state = advanceMeeting(undefined, meeting, 0)!;
    expect(state.stage).toBe("SCANNER_REVIEW");
    const speaking = advanceMeeting(state, meeting, state.until)!;
    expect(
      characterPresence("momentum", { playback: speaking, snapshot: meeting }),
    ).toBe("SEATED");
    let finished = speaking;
    const roles = [finished.speaker];
    for (let i = 0; i < 12 && finished.phase !== "done"; i++) {
      finished = advanceMeeting(finished, meeting, finished.until)!;
      if (finished.phase === "speaking") roles.push(finished.speaker);
    }
    expect(roles).toEqual(meeting.turns.map((t) => t.character));
    expect(finished.phase).toBe("done");
  });
  it("finishes the visible meeting, skips intermediate cron results, and starts only the latest", () => {
    const first = scannerMeeting(review);
    const second = scannerMeeting({ ...review, id: "SCANNER-2100000" });
    const latest = scannerMeeting({ ...review, id: "SCANNER-2400000" });
    const state = advanceMeeting(undefined, first, 0)!;
    expect(holdMeeting(first, state, second, first)).toBe(first);
    expect(holdMeeting(first, state, latest, first)).toBe(first);
    expect(
      holdMeeting(first, { ...state, phase: "returning" }, latest, first),
    ).toBe(first);
    expect(holdMeeting(first, { ...state, phase: "done" }, latest, first)).toBe(
      latest,
    );
    expect(
      advanceMeeting({ ...state, phase: "done" }, latest, 999999)?.caseId,
    ).toBe(latest.case_id);
  });
  it("refreshes held AI output and cancellation while a newer cron is pending", () => {
    const first = {
      ...scannerMeeting(review),
      kind: "AI" as const,
      finished: false,
      turns: [],
    };
    const latest = scannerMeeting({ ...review, id: "SCANNER-latest" });
    const state = advanceMeeting(undefined, first, 0)!;
    const stopped = {
      ...first,
      status: "STALE",
      cancelled: true,
      finished: true,
    };
    expect(holdMeeting(first, state, latest, stopped)).toBe(stopped);
    expect(advanceMeeting(state, stopped, 1)?.phase).toBe("returning");
    expect(holdMeeting(first, state, latest, null)?.cancelled).toBe(true);
  });
  it("explains unavailable data without claiming group results or calling them AI failures", () => {
    const meeting = scannerMeeting({
      ...review,
      reason: "MARKET_UNAVAILABLE",
      candle_timestamp: null,
      groups: [],
    });
    expect(meeting.turns.map((t) => t.character)).toEqual(["risk", "boss"]);
    expect(meeting.unavailable).toEqual([]);
    expect(scannerReviewSummary(meeting.scan!)).not.toContain("2 BUY");
  });
});
