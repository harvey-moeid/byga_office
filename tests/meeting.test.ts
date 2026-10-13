import { describe, expect, it } from "vitest";
import {
  characterIds,
  type Analysis,
  type CharacterId,
} from "../src/core/contracts";
import {
  meetingTurns,
  meetingFailureReason,
  participantsFromContext,
  type MeetingSnapshot,
} from "../src/core/meeting";
import {
  advanceMeeting,
  speechExcerpt,
  MEETING_TRAVEL_TIMEOUT,
} from "../src/ui/meeting";

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
  it("limits compact meetings to the selected council and excludes inactive output from speech and failure notices", () => {
    const participants = participantsFromContext(
      JSON.stringify({
        config: { aiVoterCount: 4 },
        private: "private-prompt",
      }),
    );
    expect(participants).toEqual([
      "trend",
      "structure",
      "volume",
      "derivatives",
      "risk",
      "boss",
    ]);
    expect(participantsFromContext("{}")).toEqual(characterIds);
    const output = meetingTurns(
      characterIds.map((id) =>
        JSON.stringify({
          id,
          status: id === "quant" ? "UNAVAILABLE" : "SUCCESS",
          output: analysis,
        }),
      ),
      participants,
    );
    expect(output.turns.map((turn) => turn.character)).toEqual(participants);
    expect(output.unavailable).toEqual([]);
    expect(JSON.stringify(participants)).not.toContain("private-prompt");
  });
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
  it("waits beyond the old gathering timer until every selected participant is seated", () => {
    const arrivals = new Set<CharacterId>(characterIds.filter((id) => id !== "risk"));
    const gathering = advanceMeeting(undefined, complete, 0, false, arrivals)!;
    expect(advanceMeeting(gathering, complete, 18000, false, arrivals)).toBe(
      gathering,
    );
    arrivals.add("risk");
    expect(
      advanceMeeting(gathering, complete, 18000, false, arrivals)?.speaker,
    ).toBe("trend");
  });
  it("waits for Boss arrival and ignores unselected analysts in compact meetings", () => {
    const compact = {
      ...complete,
      participants: [
        "trend",
        "risk",
        "boss",
      ] as MeetingSnapshot["participants"],
    };
    const arrivals = new Set(["trend", "risk"] as const);
    const gathering = advanceMeeting(undefined, compact, 0, false, arrivals)!;
    expect(
      advanceMeeting(gathering, compact, 3000, false, arrivals)?.phase,
    ).toBe("speaking");
    const boss = {
      ...gathering,
      phase: "boss-entering" as const,
      stage: "BOSS_DECISION",
      shown: characterIds.filter((id) => id !== "boss"),
    };
    expect(advanceMeeting(boss, compact, 20000, false, arrivals)).toBe(boss);
    expect(
      advanceMeeting(
        boss,
        compact,
        20000,
        false,
        new Set([...arrivals, "boss"]),
      )?.speaker,
    ).toBe("boss");
  });
  it("bounds missing arrival reports and lets cancellation interrupt travel immediately", () => {
    const arrivals = new Set<CharacterId>();
    const gathering = advanceMeeting(undefined, complete, 0, false, arrivals)!;
    expect(
      advanceMeeting(
        gathering,
        complete,
        MEETING_TRAVEL_TIMEOUT,
        false,
        arrivals,
      )?.phase,
    ).toBe("speaking");
    expect(
      advanceMeeting(
        gathering,
        { ...complete, cancelled: true },
        1,
        false,
        arrivals,
      )?.phase,
    ).toBe("returning");
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
  it("keeps a concise single-sentence excerpt without changing the full output", () => {
    expect(speechExcerpt("Satu. Dua! Tiga.")).toBe("Satu.");
    expect(speechExcerpt("a".repeat(500))).toHaveLength(118);
    expect(speechExcerpt("Volume naik 1.25 kali. Entry 0.0012.")).toBe(
      "Volume naik 1.25 kali.",
    );
    expect(analysis.reasoning).toContain("nyata");
  });
});

describe("meeting failure diagnostics", () => {
  it("classifies public provider failure categories without exposing raw errors", () => {
    expect(
      meetingFailureReason(
        { status: "UNAVAILABLE", validationErrors: ["PROVIDER_HTTP_402"] },
        false,
      ),
    ).toContain("402");
    expect(
      meetingFailureReason(
        { status: "UNAVAILABLE", validationErrors: ["PROVIDER_HTTP_400"] },
        false,
      ),
    ).toContain("400");
    expect(
      meetingFailureReason(
        { status: "UNAVAILABLE", validationErrors: ["PROVIDER_HTTP_404"] },
        false,
      ),
    ).toContain("404");
    expect(
      meetingFailureReason(
        {
          status: "UNAVAILABLE",
          validationErrors: ["PROVIDER_NOT_CONFIGURED"],
        },
        false,
      ),
    ).toContain("dikonfigurasi");
    expect(
      meetingFailureReason({ status: "TIMEOUT", validationErrors: [] }, false),
    ).toContain("batas waktu");
    const raw = "SECRET_ERROR_FROM_PROVIDER";
    expect(
      meetingFailureReason(
        { status: "UNAVAILABLE", validationErrors: [raw] },
        false,
      ),
    ).not.toContain(raw);
  });
  it("marks invalid saved outputs as unavailable and never invents a vote", () => {
    const report = meetingTurns([
      JSON.stringify({
        id: "momentum",
        status: "UNAVAILABLE",
        output: null,
        validationErrors: ["PROVIDER_HTTP_400"],
      }),
    ]);
    expect(report.turns).toHaveLength(0);
    expect(report.unavailable).toEqual(["momentum"]);
    expect(report.failureReasons.momentum).toContain("400");
  });
});
