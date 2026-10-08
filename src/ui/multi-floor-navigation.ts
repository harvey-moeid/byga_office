import { characterIds } from "../core/contracts";
import {
  BOSS_OFFICE_LAYOUT,
  STAIR_LAYOUT,
  UPPER_FLOOR_Y,
  UPPER_MEETING_SEATS,
} from "./office-layout";
import {
  destination as groundDestination,
  isAttendingMeeting,
  meetingSeats,
  planRoute,
  seatedFacing,
  type Point,
} from "./navigation";
import type { MeetingFloor } from "./meeting-venue";

export type OfficeFloor = 1 | 2;
export type WorldPoint = readonly [number, number, number];

export interface CharacterTarget {
  floor: OfficeFloor;
  position: WorldPoint;
  facing: number;
}

export const STAIR_BASE: WorldPoint = [
  STAIR_LAYOUT.x,
  0,
  STAIR_LAYOUT.startZ + 0.52,
];

export const UPPER_LANDING: WorldPoint = [
  STAIR_LAYOUT.openingWestX - 0.2,
  UPPER_FLOOR_Y,
  STAIR_LAYOUT.landingZ,
];

function stairSteps(): WorldPoint[] {
  return Array.from({ length: STAIR_LAYOUT.stepCount }, (_, index) => [
    STAIR_LAYOUT.x,
    STAIR_LAYOUT.startY +
      index * STAIR_LAYOUT.rise +
      STAIR_LAYOUT.stepThickness / 2,
    STAIR_LAYOUT.startZ - index * STAIR_LAYOUT.run,
  ] as WorldPoint);
}

export const STAIR_ASCENT = stairSteps();

function groundRoute(start: WorldPoint, end: WorldPoint): WorldPoint[] {
  const route = planRoute([start[0], start[2]], [end[0], end[2]]);
  return route.map(([x, z]) => [x, 0, z] as WorldPoint);
}

const UPPER_CORRIDOR_X = 6.68;

function insideBossOffice(point: WorldPoint) {
  return (
    point[0] >= BOSS_OFFICE_LAYOUT.roomMinX &&
    point[0] <= BOSS_OFFICE_LAYOUT.roomMaxX &&
    point[2] >= BOSS_OFFICE_LAYOUT.roomMinZ &&
    point[2] <= BOSS_OFFICE_LAYOUT.roomMaxZ
  );
}

function bossOfficeEntry(end: WorldPoint): WorldPoint[] {
  return [
    [UPPER_CORRIDOR_X, UPPER_FLOOR_Y, 1.0],
    [UPPER_CORRIDOR_X, UPPER_FLOOR_Y, 2.9],
    [BOSS_OFFICE_LAYOUT.doorX, UPPER_FLOOR_Y, 3.05],
    [BOSS_OFFICE_LAYOUT.doorX, UPPER_FLOOR_Y, 3.72],
    [
      BOSS_OFFICE_LAYOUT.deskBypassX,
      UPPER_FLOOR_Y,
      BOSS_OFFICE_LAYOUT.deskBypassZ,
    ],
    end,
  ];
}

function upperRouteFromLanding(end: WorldPoint): WorldPoint[] {
  if (insideBossOffice(end)) return bossOfficeEntry(end);

  const route: WorldPoint[] = [[UPPER_CORRIDOR_X, UPPER_FLOOR_Y, 1.0]];

  if (end[2] > 3.1) {
    route.push(
      [UPPER_CORRIDOR_X, UPPER_FLOOR_Y, 3.02],
      [UPPER_CORRIDOR_X, UPPER_FLOOR_Y, Math.min(5.45, end[2])],
    );
  } else if (end[2] < -2.3) {
    route.push([UPPER_CORRIDOR_X, UPPER_FLOOR_Y, -3.72]);
  } else if (end[2] < 0) {
    route.push([UPPER_CORRIDOR_X, UPPER_FLOOR_Y, -0.72]);
  }

  route.push(end);
  return route;
}

function upperRouteToLanding(start: WorldPoint): WorldPoint[] {
  if (insideBossOffice(start))
    return [
      [
        BOSS_OFFICE_LAYOUT.deskBypassX,
        UPPER_FLOOR_Y,
        BOSS_OFFICE_LAYOUT.deskBypassZ,
      ],
      [BOSS_OFFICE_LAYOUT.doorX, UPPER_FLOOR_Y, 3.72],
      [BOSS_OFFICE_LAYOUT.doorX, UPPER_FLOOR_Y, 3.05],
      [UPPER_CORRIDOR_X, UPPER_FLOOR_Y, 2.9],
      [UPPER_CORRIDOR_X, UPPER_FLOOR_Y, 1.0],
      UPPER_LANDING,
    ];

  const route = upperRouteFromLanding(start);
  return [...route.slice(0, -1).reverse(), UPPER_LANDING];
}

function nearestStairIndex(start: WorldPoint) {
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  STAIR_ASCENT.forEach((point, index) => {
    const next = Math.hypot(
      point[0] - start[0],
      point[1] - start[1],
      point[2] - start[2],
    );
    if (next < distance) {
      distance = next;
      nearest = index;
    }
  });
  return nearest;
}

function onStair(start: WorldPoint) {
  const index = nearestStairIndex(start);
  const point = STAIR_ASCENT[index];
  return (
    Math.abs(start[0] - STAIR_LAYOUT.x) < STAIR_LAYOUT.width &&
    Math.hypot(start[1] - point[1], start[2] - point[2]) < 0.85
  );
}

export function characterTarget(
  index: number,
  state: string,
  meetingFloor: MeetingFloor,
  upperFloorAvailable: boolean,
): CharacterTarget {
  if (isAttendingMeeting(index, state)) {
    if (upperFloorAvailable && meetingFloor === 2) {
      const seat = UPPER_MEETING_SEATS[index];
      return {
        floor: 2,
        position: [seat.position[0], UPPER_FLOOR_Y, seat.position[1]],
        facing: seat.facing,
      };
    }
    const seat = meetingSeats[index];
    return {
      floor: 1,
      position: [seat.position[0], 0, seat.position[1]],
      facing: seat.facing,
    };
  }

  if (characterIds[index] === "boss" && upperFloorAvailable)
    return {
      floor: 2,
      position: [
        BOSS_OFFICE_LAYOUT.seatX,
        UPPER_FLOOR_Y,
        BOSS_OFFICE_LAYOUT.seatZ,
      ],
      facing: BOSS_OFFICE_LAYOUT.facing,
    };

  const [x, z] = groundDestination(index, state);
  return {
    floor: 1,
    position: [x, 0, z],
    facing: seatedFacing(index, state),
  };
}

export function planWorldRoute(
  start: WorldPoint,
  target: CharacterTarget,
): WorldPoint[] {
  const targetPoint = target.position;
  if (
    Math.hypot(
      targetPoint[0] - start[0],
      targetPoint[1] - start[1],
      targetPoint[2] - start[2],
    ) < 0.08
  )
    return [];

  const stairIndex = nearestStairIndex(start);

  if (onStair(start)) {
    if (target.floor === 2)
      return [
        ...STAIR_ASCENT.slice(Math.min(stairIndex + 1, STAIR_ASCENT.length)),
        [STAIR_LAYOUT.landingX, UPPER_FLOOR_Y, STAIR_LAYOUT.landingZ],
        UPPER_LANDING,
        ...upperRouteFromLanding(targetPoint),
      ];
    return [
      ...STAIR_ASCENT.slice(0, stairIndex).reverse(),
      STAIR_BASE,
      ...groundRoute(STAIR_BASE, targetPoint),
    ];
  }

  const currentFloor: OfficeFloor =
    start[1] > UPPER_FLOOR_Y * 0.55 ? 2 : 1;

  if (currentFloor === target.floor) {
    if (currentFloor === 1) return groundRoute(start, targetPoint);
    if (targetPoint[2] > 2.8 || start[2] > 2.8)
      return [
        ...upperRouteToLanding(start).slice(0, -1),
        ...upperRouteFromLanding(targetPoint),
      ];
    return [targetPoint];
  }

  if (target.floor === 2)
    return [
      ...groundRoute(start, STAIR_BASE),
      ...STAIR_ASCENT,
      [STAIR_LAYOUT.landingX, UPPER_FLOOR_Y, STAIR_LAYOUT.landingZ],
      UPPER_LANDING,
      ...upperRouteFromLanding(targetPoint),
    ];

  return [
    ...upperRouteToLanding(start),
    [STAIR_LAYOUT.landingX, UPPER_FLOOR_Y, STAIR_LAYOUT.landingZ],
    ...STAIR_ASCENT.slice().reverse(),
    STAIR_BASE,
    ...groundRoute(STAIR_BASE, targetPoint),
  ];
}

export function routeHasFloorTransition(route: readonly WorldPoint[]) {
  return route.some((point) => point[1] > 0.45);
}

export function toGroundPoint(point: WorldPoint): Point {
  return [point[0], point[2]];
}
