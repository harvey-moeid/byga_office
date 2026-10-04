import { describe, expect, it } from "vitest";
import { characterIds, type Analysis } from "../src/core/contracts";
import { meetingTurns, type MeetingSnapshot } from "../src/core/meeting";
import { advanceMeeting, speechExcerpt } from "../src/ui/meeting";

const analysis: Analysis = {
  vote: "BUY",
  confidence: 70,
  summary: "Harga menembus resistance. Volume mendukung.",
  reasoning: "Alasan nyata dari output AI tersimpan.",
  evidence: [],
  risk_flags: [],
  price_levels: null,
};
const complete: MeetingSnapshot = {
  case_id: "CASE-1",
  status: "COMPLETED",
  finished: true,
  cancelled: false,
  turns: characterIds.map((character) => ({ character, analysis })),
  unavailable: [],
};
describe("meeting presentation", () => {
  it("publishes actual validated output in role order without private metadata or fabricated failure speech", () => {
    const output = meetingTurns([
      JSON.stringify({
        id: "boss",
        status: "SUCCESS",
        output: analysis,
        provider: "private-provider",
        prompt: "private-prompt",
      }),
      JSON.stringify({ id: "trend", status: "SUCCESS", output: analysis }),
      JSON.stringify({ id: "risk", status: "UNAVAILABLE", output: analysis }),
      "null",
      "invalid JSON",
    ]);
    expect(output.turns.map((turn) => turn.character)).toEqual([
      "trend",
      "boss",
    ]);
    expect(output.unavailable).toEqual(["risk"]);
    expect(JSON.stringify(output)).not.toContain("private-");
  });
  it("shows each speaker once, admits Boss only after Risk, then closes and returns", () => {
    let state = advanceMeeting(undefined, complete, 0)!;
    const speakers: string[] = [];
    expect(state.stage).toBe("AI_ANALYSIS");
    for (let i = 0; i < 15 && state.phase !== "done"; i++) {
      state = advanceMeeting(state, complete, state.until)!;
      if (state.phase === "speaking") speakers.push(state.speaker!);
      if (state.phase === "boss-entering") expect(speakers.at(-1)).toBe("risk");
      const same = advanceMeeting(state, { ...complete }, state.until - 1);
      expect(same).toBe(state);
    }
    expect(speakers).toEqual(characterIds);
    expect(state.phase).toBe("done");
    expect(state.stage).toBe("RETURN_TO_DESK");
    expect(advanceMeeting(state, complete, 999999)).toBe(state);
  });
  it("waits for real output and resumes when it arrives", () => {
    const waiting = {
      ...complete,
      status: "AI_ANALYSIS",
      finished: false,
      turns: [],
    };
    let state = advanceMeeting(undefined, waiting, 0)!;
    state = advanceMeeting(state, waiting, state.until)!;
    expect(state.phase).toBe("waiting");
    expect(state.speaker).toBeUndefined();
    state = advanceMeeting(
      state,
      { ...waiting, turns: complete.turns.slice(0, 1) },
      20000,
    )!;
    expect(state.speaker).toBe("trend");
  });
  it("stops stale dialogue on cancellation or a new case and never invents Boss output", () => {
    let state = advanceMeeting(undefined, complete, 0)!;
    state = advanceMeeting(state, { ...complete, cancelled: true }, 1)!;
    expect(state.phase).toBe("returning");
    expect(state.speaker).toBeUndefined();
    expect(
      advanceMeeting(state, { ...complete, case_id: "CASE-2" }, 2)?.shown,
    ).toEqual([]);
    const unavailable = {
      ...complete,
      turns: [],
      unavailable: [...characterIds],
    };
    state = advanceMeeting(undefined, unavailable, 0)!;
    state = advanceMeeting(state, unavailable, state.until)!;
    expect(state.phase).toBe("boss-entering");
    state = advanceMeeting(state, unavailable, state.until)!;
    expect(state.phase).toBe("returning");
    expect(state.speaker).toBeUndefined();
  });
  it("keeps a concise two-sentence excerpt without changing the full output", () => {
    expect(speechExcerpt("Satu. Dua! Tiga.")).toBe("Satu. Dua!");
    expect(speechExcerpt("a".repeat(500))).toHaveLength(188);
    expect(analysis.reasoning).toContain("nyata");
  });
});
