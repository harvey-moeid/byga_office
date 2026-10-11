import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { advanceCharacterRoute } from "../src/ui/character-locomotion";
import {
  characterTarget,
  planWorldRoute,
} from "../src/ui/multi-floor-navigation";
import { characterIds } from "../src/core/contracts";
import { segmentClear } from "../src/ui/navigation";

describe("continuous character locomotion", () => {
  it("uses the complete frame budget across small stair waypoints", () => {
    const position = new Vector3();
    const route = Array.from(
      { length: 20 },
      (_, i) => new Vector3(0, (i + 1) * 0.01, 0),
    );
    const result = advanceCharacterRoute(
      position,
      route,
      2,
      0.1,
      2,
      new Vector3(),
    );
    expect(result.traveled).toBeCloseTo(0.2);
    expect(position.y).toBeCloseTo(0.2);
    expect(route).toHaveLength(0);
    expect(result.speed).toBe(0);
  });

  it("turns through every corner instead of cutting diagonally", () => {
    const position = new Vector3();
    const route = [
      new Vector3(1, 0, 0),
      new Vector3(1, 0, 1),
      new Vector3(2, 0, 1),
    ];
    const direction = new Vector3();
    let speed = 0;
    for (let i = 0; i < 240 && route.length; i++) {
      const result = advanceCharacterRoute(
        position,
        route,
        speed,
        1 / 60,
        1.25,
        direction,
      );
      speed = result.speed;
      expect(position.z === 0 || position.x === 1 || position.z === 1).toBe(
        true,
      );
    }
    expect(position.toArray()).toEqual([2, 0, 1]);
    expect(speed).toBe(0);
  });

  it("starts gently and brakes before arriving", () => {
    const position = new Vector3();
    const route = [new Vector3(0, 0, 3)];
    let speed = advanceCharacterRoute(
      position,
      route,
      0,
      1 / 60,
      1.25,
      new Vector3(),
    ).speed;
    expect(speed).toBeGreaterThan(0);
    expect(speed).toBeLessThan(0.2);
    for (let i = 0; i < 145; i++)
      speed = advanceCharacterRoute(
        position,
        route,
        speed,
        1 / 60,
        1.25,
        new Vector3(),
      ).speed;
    expect(speed).toBeLessThan(1.25);
    expect(position.z).toBeLessThanOrEqual(3);
  });

  for (const dt of [1 / 60, 1 / 12, 0.5])
    it(`gets the team upstairs within the meeting window at dt=${dt}`, () => {
      characterIds.slice(0, -1).forEach((_, index) => {
        const start = characterTarget(index, "MONITORING", 1, true);
        const target = characterTarget(index, "AI_ANALYSIS", 2, true);
        const position = new Vector3(...start.position);
        const planned = planWorldRoute(start.position, target);
        let previous = start.position;
        for (const point of planned) {
          if (previous[1] === 0 && point[1] === 0)
            expect(
              segmentClear([previous[0], previous[2]], [point[0], point[2]]),
            ).toBe(true);
          previous = point;
        }
        const route = planned.map((point) => new Vector3(...point));
        let speed = 0;
        for (let time = 0; time < 14 && route.length; time += dt)
          speed = advanceCharacterRoute(
            position,
            route,
            speed,
            dt,
            2.7,
            new Vector3(),
          ).speed;
        expect(route, `character ${index}`).toHaveLength(0);
        expect(position.toArray()).toEqual(target.position);
      });
    });

  it("does not move when the planner has no safe route", () => {
    const position = new Vector3(1, 0, 2);
    const result = advanceCharacterRoute(
      position,
      [],
      2,
      0.5,
      2,
      new Vector3(),
    );
    expect(position.toArray()).toEqual([1, 0, 2]);
    expect(result).toEqual({ speed: 0, traveled: 0 });
  });
});
