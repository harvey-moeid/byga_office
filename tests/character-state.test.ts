import { describe, expect, it } from "vitest";
import type { MeetingSnapshot } from "../src/core/meeting";
import type { MeetingPlayback } from "../src/ui/meeting";
import {
  activityLabels,
  characterGroupLabels,
  characterPresence,
} from "../src/ui/character-state";

const snapshot: MeetingSnapshot = {
  case_id: "CASE-presence",
  status: "AI_ANALYSIS",
  finished: false,
  cancelled: false,
  turns: [
    {
      character: "trend",
      analysis: {
        vote: "BUY",
        confidence: 80,
        summary: "Trend mendukung.",
        reasoning: "Directional evidence tersedia.",
        evidence: [],
        risk_flags: [],
        price_levels: null,
      },
    },
  ],
  unavailable: ["quant"],
};

function playback(
  phase: MeetingPlayback["phase"],
  overrides: Partial<MeetingPlayback> = {},
): MeetingPlayback {
  return {
    caseId: snapshot.case_id,
    phase,
    stage: "AI_ANALYSIS",
    shown: [],
    until: 1,
    ...overrides,
  };
}

describe("3D character presence", () => {
  it("keeps decorative activity explicit without implying an AI call", () => {
    expect(
      characterPresence("volume", {
        activity: "group-market-review",
      }),
    ).toBe(activityLabels["group-market-review"]);
    expect(characterPresence("volume", {})).toBe("MONITORING");
  });

  it("tracks meeting state per character instead of one global busy flag", () => {
    const gathering = playback("gathering");
    expect(
      characterPresence("trend", { playback: gathering, snapshot }),
    ).toBe("WALKING TO MEETING");
    expect(
      characterPresence("boss", { playback: gathering, snapshot }),
    ).toBe("WAITING IN OFFICE");

    const speaking = playback("speaking", { speaker: "trend" });
    expect(
      characterPresence("trend", { playback: speaking, snapshot }),
    ).toBe("SPEAKING");
    expect(
      characterPresence("structure", { playback: speaking, snapshot }),
    ).toBe("WAITING FOR OUTPUT");
    expect(
      characterPresence("quant", { playback: speaking, snapshot }),
    ).toBe("OUTPUT UNAVAILABLE");

    const bossEntering = playback("boss-entering", {
      stage: "BOSS_DECISION",
    });
    expect(
      characterPresence("boss", { playback: bossEntering, snapshot }),
    ).toBe("WALKING TO MEETING");
    expect(
      characterPresence("trend", { playback: bossEntering, snapshot }),
    ).toBe("SEATED");

    const returning = playback("returning", { stage: "RETURN_TO_DESK" });
    expect(
      characterPresence("trend", { playback: returning, snapshot }),
    ).toBe("RETURNING");
  });

  it("keeps role groups aligned with the four analysis groups and authorities", () => {
    expect(characterGroupLabels.trend).toBe("SMC / ICT");
    expect(characterGroupLabels.momentum).toBe("Indicators");
    expect(characterGroupLabels.quant).toBe("Volume");
    expect(characterGroupLabels.positioning).toBe("Derivatives / Positioning");
    expect(characterGroupLabels.risk).toBe("Risk authority");
    expect(characterGroupLabels.boss).toBe("Final authority");
  });
});
