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
import {
  initialQuality,
  adaptQuality,
  parseQualityMode,
  profiles,
  qualityModes,
} from "../src/ui/quality";
import {
  FIRST_ACTIVITY_DELAY,
  NEXT_ACTIVITY_DELAY,
  activityDelayMs,
  activityDestinations,
  createOfficeActivityEvent,
} from "../src/ui/office-activity";
describe("office navigation", () => {
  for (const state of ["AI_ANALYSIS", "MONITORING", "COFFEE"])
    it(`all ten characters reach ${state} without crossing furniture/walls`, () => {
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
        if (index === characterIds.indexOf("boss") && !isAttendingMeeting(index, state)) {
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
    const bossIndex = characterIds.indexOf("boss");
    const desk = destination(bossIndex, "AI_ANALYSIS");
    const seat = destination(bossIndex, "BOSS_DECISION");
    expect(seat).toEqual(meetingSeats[bossIndex].position);
    for (const [start, end] of [
      [desk, seat],
      [seat, destination(bossIndex, "RETURN_TO_DESK")],
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
  it("keeps every dynamic activity destination walkable and routable", () => {
    for (const spot of activityDestinations()) {
      expect(walkable(spot)).toBe(true);
      characterIds.forEach((_, index) => {
        const desk = destination(index, "MONITORING");
        expect(planRoute(desk, spot).length, `desk ${index} -> ${spot}`).toBeGreaterThan(0);
        expect(planRoute(spot, desk).length, `${spot} -> desk ${index}`).toBeGreaterThan(0);
      });
    }
  });
  it("schedules varied activity events for two to six characters", () => {
    let seed = 0x5eed1234;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const modes = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const event = createOfficeActivityEvent(random);
      const assignments = Object.values(event.assignments).filter(Boolean);
      expect(assignments.length).toBeGreaterThanOrEqual(2);
      expect(assignments.length).toBeLessThanOrEqual(6);
      expect(event.durationMs).toBeGreaterThanOrEqual(10_000);
      expect(event.durationMs).toBeLessThanOrEqual(60_000);
      const destinations = assignments.map((activity) =>
        activity!.destination.join(","),
      );
      expect(new Set(destinations).size).toBe(destinations.length);
      assignments.forEach((activity) => {
        expect(activity!.durationMs).toBeGreaterThanOrEqual(10_000);
        expect(activity!.durationMs).toBeLessThanOrEqual(60_000);
        expect(walkable(activity!.destination)).toBe(true);
      });
      modes.add(event.mode);
    }
    expect(modes).toEqual(new Set(["individual", "group"]));
  });
  it("uses the agreed first and recurring activity timing windows", () => {
    expect(activityDelayMs(true, () => 0)).toBe(FIRST_ACTIVITY_DELAY.min);
    expect(activityDelayMs(true, () => 0.999999)).toBeLessThanOrEqual(
      FIRST_ACTIVITY_DELAY.max,
    );
    expect(activityDelayMs(false, () => 0)).toBe(NEXT_ACTIVITY_DELAY.min);
    expect(activityDelayMs(false, () => 0.999999)).toBeLessThanOrEqual(
      NEXT_ACTIVITY_DELAY.max,
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
    expect(adaptQuality("ultra", 24)).toBe("high");
    expect(adaptQuality("high", 24)).toBe("medium");
    expect(adaptQuality("medium", 22)).toBe("low");
    expect(adaptQuality("low", 60)).toBe("low");
    expect(profiles.low.shadows).toBe(false);
    expect(profiles.low.decorative).toBe(false);
    expect(profiles.ultra.dpr).toBeGreaterThan(profiles.high.dpr);
    expect(profiles.ultra.shadowSize).toBeGreaterThan(profiles.high.shadowSize);
  });
  it("accepts only supported persistent quality modes", () => {
    expect(qualityModes).toEqual(["auto", "low", "medium", "high", "ultra"]);
    for (const mode of qualityModes) expect(parseQualityMode(mode)).toBe(mode);
    expect(parseQualityMode("cinematic")).toBe("auto");
    expect(parseQualityMode(null)).toBe("auto");
  });
});
