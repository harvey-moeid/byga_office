import { describe, it, expect } from "vitest";
import { characterIds } from "../src/core/contracts";
import {
  destination,
  isAttendingMeeting,
  desks,
  meetingSeats,
  seatedFacing,
  planMovement,
  planRoute,
  segmentClear,
  walkable,
  type Point,
} from "../src/ui/navigation";
import { initialQuality, adaptQuality, profiles } from "../src/ui/quality";
describe("office navigation", () => {
  for (const state of ["AI_ANALYSIS", "MONITORING", "COFFEE"])
    it(`all eight characters reach ${state} without crossing furniture/walls`, () => {
      characterIds.forEach((_, i) => {
        const start = destination(
          i,
          state === "MONITORING" ? "AI_ANALYSIS" : "MONITORING",
        );
        const end = destination(i, state, state === "COFFEE");
        const route = planRoute(start, end);
        expect(route.length, `character ${i}`).toBeGreaterThan(0);
        expect(route.at(-1)).toEqual(end);
        let previous: Point = start;
        route.forEach((p) => {
          expect(walkable(p)).toBe(true);
          expect(segmentClear(previous, p)).toBe(true);
          previous = p;
        });
      });
    });
  it("all meeting seats face into the table throughout each meeting phase", () => {
    for (const state of [
      "TRIGGERED",
      "AI_ANALYSIS",
      "AI_DEGRADED",
      "RISK_REVIEW",
      "BOSS_DECISION",
      "DISCORD",
    ]) {
      characterIds.forEach((_, index) => {
        if (index === 7 && !isAttendingMeeting(index, state)) {
          expect(destination(index, state)).toEqual([
            desks[index][0],
            desks[index][1] + 0.72,
          ]);
          expect(seatedFacing(index, state)).toBe(Math.PI);
          return;
        }
        const [x, z] = destination(index, state);
        const yaw = seatedFacing(index, state);
        expect(
          Math.sin(yaw) * (5 - x) + Math.cos(yaw) * (1 - z),
        ).toBeGreaterThan(0);
        expect(meetingSeats[index].position).toEqual([x, z]);
        expect(meetingSeats[index].facing).toBe(yaw);
        expect(seatedFacing(index, "MONITORING")).toBe(Math.PI);
      });
    }
  });
  it("Boss enters at the final stage and returns through a walkable route", () => {
    const desk = destination(7, "AI_ANALYSIS");
    const seat = destination(7, "BOSS_DECISION");
    expect(seat).toEqual(meetingSeats[7].position);
    for (const [start, end] of [
      [desk, seat],
      [seat, destination(7, "RETURN_TO_DESK")],
    ]) {
      const route = planRoute(start, end);
      expect(route.length).toBeGreaterThan(0);
      let last = start;
      for (const point of route) {
        expect(segmentClear(last, point)).toBe(true);
        last = point;
      }
      expect(last).toEqual(end);
    }
  });
  it("blocked destinations fail safely without a teleport route", () => {
    expect(planRoute([0, 0], [5, 1])).toEqual([]);
    expect(planRoute([0, 0], [20, 20])).toEqual([]);
    expect(planMovement([0, 0], [5, 1])).toEqual({ mode: "stay" });
    expect(planMovement([0, 0], [20, 20])).toEqual({ mode: "stay" });
  });
  it("uses a safe teleport only when routing to a walkable destination fails", () => {
    const impassableDivider = [{ x: 0, z: 0, w: 20, d: 0.1 }];
    expect(planMovement([0, -1], [0, 1], impassableDivider)).toEqual({
      mode: "teleport",
      destination: [0, 1],
    });
  });
  it("decorative behavior yields to the trading workflow", () => {
    expect(destination(0, "AI_ANALYSIS", true)).toEqual(
      destination(0, "AI_ANALYSIS"),
    );
  });
});
describe("adaptive quality", () => {
  it("selects conservative profiles for limited CPUs/memory", () => {
    expect(initialQuality(4, 16)).toBe("low");
    expect(initialQuality(12, 4)).toBe("low");
    expect(initialQuality(8, 8)).toBe("medium");
    expect(initialQuality(16, 16)).toBe("high");
  });
  it("steps down after a slow sample and does not oscillate upward", () => {
    expect(adaptQuality("high", 24)).toBe("medium");
    expect(adaptQuality("medium", 22)).toBe("low");
    expect(adaptQuality("low", 60)).toBe("low");
    expect(profiles.low.shadows).toBe(false);
    expect(profiles.low.decorative).toBe(false);
  });
});
