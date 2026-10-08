import { describe, expect, it } from "vitest";
import { chooseMeetingVenue } from "../src/ui/meeting-venue";

describe("meeting venue alternation", () => {
  it("starts on floor one and then alternates 1 -> 2 -> 1", () => {
    const first = chooseMeetingVenue("CASE-1", true);
    expect(first).toEqual({ caseId: "CASE-1", floor: 1 });

    const second = chooseMeetingVenue("CASE-2", true, first);
    expect(second).toEqual({ caseId: "CASE-2", floor: 2 });

    const third = chooseMeetingVenue("CASE-3", true, second);
    expect(third).toEqual({ caseId: "CASE-3", floor: 1 });
  });

  it("keeps the same venue when the same case is reloaded", () => {
    expect(
      chooseMeetingVenue("CASE-2", true, { caseId: "CASE-2", floor: 2 }),
    ).toEqual({ caseId: "CASE-2", floor: 2 });
  });

  it("forces Low mode meetings to floor one", () => {
    expect(
      chooseMeetingVenue("CASE-2", false, { caseId: "CASE-2", floor: 2 }),
    ).toEqual({ caseId: "CASE-2", floor: 1 });
    expect(
      chooseMeetingVenue("CASE-4", false, { caseId: "CASE-3", floor: 2 }),
    ).toEqual({ caseId: "CASE-4", floor: 1 });
  });
});
