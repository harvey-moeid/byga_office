import { describe, expect, it } from "vitest";
import { characterMotion } from "../src/ui/character-motion";

const base = {
  walking: false,
  sitting: false,
  meeting: false,
  speaking: false,
  atActivity: false,
  activityKind: undefined,
};

describe("characterMotion", () => {
  it("gives locomotion priority while traveling", () => {
    expect(
      characterMotion({
        ...base,
        walking: true,
        atActivity: true,
        activityKind: "coffee",
      }),
    ).toBe("walk");
  });

  it.each(["coffee", "coffee-break"] as const)(
    "maps %s activity to the coffee clip",
    (activityKind) => {
      expect(
        characterMotion({ ...base, atActivity: true, activityKind }),
      ).toBe("coffee");
    },
  );

  it("maps stretch activity to the stretch clip", () => {
    expect(
      characterMotion({ ...base, atActivity: true, activityKind: "stretch" }),
    ).toBe("stretch");
  });

  it.each(["chat", "group-chat", "briefing"] as const)(
    "maps %s activity to the talk clip",
    (activityKind) => {
      expect(
        characterMotion({ ...base, atActivity: true, activityKind }),
      ).toBe("talk");
    },
  );

  it.each(["market-review", "group-market-review"] as const)(
    "maps %s activity to the review clip",
    (activityKind) => {
      expect(
        characterMotion({ ...base, atActivity: true, activityKind }),
      ).toBe("review");
    },
  );

  it("types at the workstation, sits silently in meetings, and talks when speaking", () => {
    expect(characterMotion({ ...base, sitting: true })).toBe("type");
    expect(characterMotion({ ...base, sitting: true, meeting: true })).toBe(
      "sit",
    );
    expect(
      characterMotion({
        ...base,
        sitting: true,
        meeting: true,
        speaking: true,
      }),
    ).toBe("talk");
  });

  it("keeps unmatched standing activity neutral", () => {
    expect(
      characterMotion({
        ...base,
        atActivity: true,
        activityKind: "roam",
      }),
    ).toBe("idle");
  });
});
