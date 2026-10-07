import { describe, it, expect } from "vitest";
import { characterIds } from "../src/core/contracts";
import {
  analystDesks,
  analystFloor,
  destination,
  isAttendingMeeting,
  desks,
  meetingSeats,
  obstacles,
  seatedFacing,
  planMovement,
  planRoute,
  segmentClear,
  walkable,
  type Point,
} from "../src/ui/navigation";
import {
  BOSS_OFFICE_LAYOUT,
  EAST_OUTER_WALL_X,
  GROUND_EXECUTIVE_STATION_LAYOUT,
  LOWER_MEETING_VIEW,
  STAIR_LAYOUT,
  UPPER_EAST_WALL_X,
  UPPER_FLOOR_Y,
  UPPER_MEETING_SEATS,
  UPPER_MEETING_VIEW,
} from "../src/ui/office-layout";
import {
  characterTarget,
  planWorldRoute,
} from "../src/ui/multi-floor-navigation";
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
  COFFEE_MACHINE,
  COFFEE_SERVICE_SPOTS,
  activityDelayMs,
  activityDestinations,
  advanceRoamActivity,
  createOfficeActivityEvent,
} from "../src/ui/office-activity";
describe("office navigation", () => {
  it("keeps the eight analyst workstations centered, spaced and clear of the floor label", () => {
    expect(analystDesks).toHaveLength(8);
    expect(desks.slice(0, analystDesks.length)).toEqual(analystDesks);

    const rowCounts = new Map<number, number>();
    for (const [x, z] of analystDesks) {
      rowCounts.set(z, (rowCounts.get(z) ?? 0) + 1);
      // Desk footprint stays comfortably inside the Analyst Floor.
      expect(x - 0.8).toBeGreaterThan(
        analystFloor.x - analystFloor.w / 2 + 0.25,
      );
      expect(x + 0.8).toBeLessThan(
        analystFloor.x + analystFloor.w / 2 - 0.25,
      );
      expect(z - 0.425).toBeGreaterThan(
        analystFloor.z - analystFloor.d / 2 + 0.15,
      );
      // The seated character/chair anchor also stays inside the room.
      expect(z + 0.72).toBeLessThanOrEqual(
        analystFloor.z + analystFloor.d / 2,
      );
    }
    expect([...rowCounts.values()]).toEqual([3, 3, 2]);

    for (let i = 0; i < analystDesks.length; i++)
      for (let j = i + 1; j < analystDesks.length; j++) {
        const [ax, az] = analystDesks[i];
        const [bx, bz] = analystDesks[j];
        const separatedX = Math.abs(ax - bx) >= 2.4;
        const separatedZ = Math.abs(az - bz) >= 1.8;
        expect(
          separatedX || separatedZ,
          `analyst desks ${i} and ${j} overlap their visual clearance`,
        ).toBe(true);
      }

    expect(analystFloor.labelPosition).toBeDefined();
    expect(analystFloor.labelPosition![0]).toBeLessThan(
      Math.min(...analystDesks.map(([x]) => x)) - 1,
    );
  });

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
  it("keeps the Boss centered at the meeting table with unique seats", () => {
    const bossIndex = characterIds.indexOf("boss");
    expect(meetingSeats[bossIndex]).toEqual({
      position: [5, 2],
      facing: Math.PI,
    });

    const anchors = meetingSeats.map(({ position }) => position.join(","));
    expect(new Set(anchors).size).toBe(meetingSeats.length);

    for (const { position } of meetingSeats) expect(walkable(position)).toBe(true);
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
  it("serves coffee from walkable spots directly in front of the pantry", () => {
    expect(COFFEE_MACHINE).toEqual([-1.15, 7]);
    expect(COFFEE_SERVICE_SPOTS).toHaveLength(6);
    for (const spot of COFFEE_SERVICE_SPOTS) {
      expect(spot[1]).toBeGreaterThanOrEqual(6.3);
      expect(spot[1]).toBeLessThan(6.5);
      expect(walkable(spot)).toBe(true);
      characterIds.forEach((_, index) => {
        const desk = destination(index, "MONITORING");
        expect(planRoute(desk, spot).length).toBeGreaterThan(0);
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

  it("keeps solo chat out of individual events", () => {
    let seed = 0x51a7cafe;
    const random = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 2 ** 32;
    };
    for (let i = 0; i < 120; i++) {
      const event = createOfficeActivityEvent(random);
      if (event.mode !== "individual") continue;
      for (const activity of Object.values(event.assignments))
        expect(activity?.kind).not.toBe("chat");
    }
  });

  it("advances roam to a different walkable waypoint without changing its lifetime", () => {
    const roam = {
      kind: "roam" as const,
      destination: [-6, 2] as Point,
      facing: Math.PI,
      durationMs: 40_000,
      group: false,
    };
    const next = advanceRoamActivity(roam, [[-6.8, -2]], () => 0);
    expect(next.destination).not.toEqual(roam.destination);
    expect(next.destination).not.toEqual([-6.8, -2]);
    expect(next.durationMs).toBe(roam.durationMs);
    expect(walkable(next.destination)).toBe(true);
    expect(planRoute(roam.destination, next.destination).length).toBeGreaterThan(
      0,
    );
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
describe("two-floor office layout", () => {
  it("keeps the staircase inside the east wall and aligned with the stairwell landing", () => {
    const stairLeftEdge = STAIR_LAYOUT.x - STAIR_LAYOUT.width / 2;
    const stairRightEdge = STAIR_LAYOUT.x + STAIR_LAYOUT.width / 2;
    expect(stairLeftEdge).toBeGreaterThan(STAIR_LAYOUT.openingWestX);
    expect(stairRightEdge).toBeLessThan(UPPER_EAST_WALL_X);
    expect(stairRightEdge).toBeLessThan(EAST_OUTER_WALL_X);

    const lastIndex = STAIR_LAYOUT.stepCount - 1;
    const topStepSurface =
      STAIR_LAYOUT.startY +
      lastIndex * STAIR_LAYOUT.rise +
      STAIR_LAYOUT.stepThickness / 2;
    expect(Math.abs(topStepSurface - UPPER_FLOOR_Y)).toBeLessThan(0.03);

    const topStepZ = STAIR_LAYOUT.startZ - lastIndex * STAIR_LAYOUT.run;
    expect(topStepZ).toBeGreaterThan(
      STAIR_LAYOUT.landingZ - STAIR_LAYOUT.landingDepth / 2,
    );
    expect(topStepZ).toBeLessThan(
      STAIR_LAYOUT.landingZ + STAIR_LAYOUT.landingDepth / 2,
    );
    expect(topStepZ).toBeGreaterThan(STAIR_LAYOUT.openingMinZ);
    expect(STAIR_LAYOUT.startZ).toBeLessThan(STAIR_LAYOUT.openingMaxZ);

    const landingLeftEdge =
      STAIR_LAYOUT.landingX - STAIR_LAYOUT.landingWidth / 2;
    expect(landingLeftEdge).toBeLessThanOrEqual(
      STAIR_LAYOUT.openingWestX + 0.02,
    );
  });

  it("keeps the floor-one glass partition clear of the stair throat", () => {
    const stairMinX = STAIR_LAYOUT.x - STAIR_LAYOUT.width / 2 - 0.12;
    const stairMaxX = STAIR_LAYOUT.x + STAIR_LAYOUT.width / 2 + 0.12;
    const crossingPartitions = partitions.filter(
      (partition) =>
        Math.abs(partition.z - 4) < 0.2 &&
        partition.x + partition.w / 2 > stairMinX &&
        partition.x - partition.w / 2 < stairMaxX,
    );
    expect(crossingPartitions).toEqual([]);
  });

  it("keeps floor-specific meeting cameras on the correct level", () => {
    expect(LOWER_MEETING_VIEW.camera[1]).toBeLessThan(UPPER_FLOOR_Y);
    expect(LOWER_MEETING_VIEW.target[1]).toBeLessThan(UPPER_FLOOR_Y);
    expect(UPPER_MEETING_VIEW.camera[1]).toBeGreaterThan(UPPER_FLOOR_Y);
    expect(UPPER_MEETING_VIEW.target[1]).toBeGreaterThan(UPPER_FLOOR_Y);
  });

  it("keeps ten unique seats in the L2 strategy room with the Boss centered", () => {
    expect(UPPER_MEETING_SEATS).toHaveLength(characterIds.length);
    const anchors = UPPER_MEETING_SEATS.map(({ position }) =>
      position.join(","),
    );
    expect(new Set(anchors).size).toBe(characterIds.length);
    expect(UPPER_MEETING_SEATS[characterIds.indexOf("boss")]).toMatchObject({
      position: [4.65, -1.22],
      facing: Math.PI,
    });
  });

  it("uses the floor-one Executive Station footprint for ground routing", () => {
    const bossObstacle = obstacles.find(
      ({ x, z }) =>
        x === GROUND_EXECUTIVE_STATION_LAYOUT.x &&
        z === GROUND_EXECUTIVE_STATION_LAYOUT.z,
    );
    expect(bossObstacle).toMatchObject({
      w: GROUND_EXECUTIVE_STATION_LAYOUT.deskWidth,
      d: GROUND_EXECUTIVE_STATION_LAYOUT.deskDepth,
    });

    const bossIndex = characterIds.indexOf("boss");
    const bossSeat = destination(bossIndex, "MONITORING");
    expect(walkable(bossSeat)).toBe(true);
    expect(
      planRoute(bossSeat, destination(bossIndex, "BOSS_DECISION")).length,
    ).toBeGreaterThan(0);
  });

  it("routes the Boss upstairs normally but keeps Low mode on floor one", () => {
    const bossIndex = characterIds.indexOf("boss");
    const upper = characterTarget(bossIndex, "MONITORING", 1, true);
    expect(upper.floor).toBe(2);
    expect(upper.position).toEqual([
      BOSS_OFFICE_LAYOUT.seatX,
      UPPER_FLOOR_Y,
      BOSS_OFFICE_LAYOUT.seatZ,
    ]);

    const low = characterTarget(bossIndex, "MONITORING", 2, false);
    expect(low.floor).toBe(1);
    expect(low.position[1]).toBe(0);
  });

  it("routes an L2 meeting through the staircase and back to L1 without teleporting", () => {
    const analystIndex = 0;
    const start = characterTarget(analystIndex, "MONITORING", 1, true);
    const upstairs = characterTarget(analystIndex, "AI_ANALYSIS", 2, true);
    const upRoute = planWorldRoute(start.position, upstairs);
    expect(upRoute.length).toBeGreaterThan(STAIR_LAYOUT.stepCount);
    expect(upRoute.some((point) => point[1] > 1)).toBe(true);
    expect(upRoute.at(-1)).toEqual(upstairs.position);

    const downstairs = characterTarget(
      analystIndex,
      "RETURN_TO_DESK",
      1,
      true,
    );
    const downRoute = planWorldRoute(upstairs.position, downstairs);
    expect(downRoute.length).toBeGreaterThan(STAIR_LAYOUT.stepCount);
    expect(downRoute.some((point) => point[1] > 1)).toBe(true);
    expect(downRoute.at(-1)).toEqual(downstairs.position);
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
    expect(profiles.low.upperFloor).toBe(false);
    expect(profiles.medium.upperFloor).toBe(true);
    expect(profiles.medium.dpr).toBe(profiles.low.dpr);
    expect(profiles.medium.shadows).toBe(false);
    expect(profiles.medium.decorative).toBe(false);
    expect(profiles.high.upperFloor).toBe(true);
    expect(profiles.ultra.upperFloor).toBe(true);
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
