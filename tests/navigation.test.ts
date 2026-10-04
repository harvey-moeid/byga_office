import { describe, it, expect } from "vitest";
import { characterIds } from "../src/core/contracts";
import {
  destination,
  planMovement,
  planRoute,
  segmentClear,
  walkable,
  type Point,
} from "../src/ui/navigation";
import { initialQuality, adaptQuality, profiles } from "../src/ui/quality";
describe("office navigation", () => {
  for (const state of ["AI_ANALYSIS", "MONITORING", "PRAYER", "COFFEE"])
    it(`all eight characters reach ${state} without crossing furniture/walls`, () => {
      characterIds.forEach((_, i) => {
        const start = destination(
          i,
          state === "MONITORING" ? "AI_ANALYSIS" : "MONITORING",
          false,
        );
        const end = destination(
          i,
          state,
          state === "PRAYER",
          state === "COFFEE",
        );
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
    expect(destination(0, "AI_ANALYSIS", false, true)).toEqual(
      destination(0, "AI_ANALYSIS", false),
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
