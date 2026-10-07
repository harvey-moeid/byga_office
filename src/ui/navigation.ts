import { characterIds } from "../core/contracts";
export type Point = readonly [number, number];
export interface Obstacle {
  x: number;
  z: number;
  w: number;
  d: number;
}
export interface Room extends Obstacle {
  label: string;
  /** Optional world-space label anchor used to keep room titles clear of furniture. */
  labelPosition?: Point;
}
export const analystFloor: Room = {
  label: "Analyst Floor",
  x: -3,
  z: 0,
  w: 9,
  d: 6,
  // Park the title on the quiet left edge instead of over the third desk row.
  labelPosition: [-6.9, 2.7],
};
export const rooms: Room[] = [
  { label: "BYGA Lobby", x: -6, z: 5.5, w: 4, d: 3 },
  analystFloor,
  { label: "Scanner Command", x: -6, z: -5, w: 4, d: 3 },
  { label: "Market Wall", x: 0, z: -5, w: 7, d: 3 },
  { label: "Risk Office", x: 6, z: -4, w: 4, d: 4 },
  { label: "War Room", x: 5, z: 1, w: 6, d: 5 },
  { label: "Boss Office", x: 6, z: 6, w: 4, d: 3 },
  { label: "Server / Data", x: -7, z: 0, w: 2, d: 3 },
  { label: "Lounge", x: -2, z: 5.5, w: 3, d: 3 },
];
// Local model +Z points forward. Both characters and chairs use the same
// seating plan, with each row looking across the table instead of away.
export const meetingSeats = Array.from({ length: characterIds.length }, (_, index) => ({
  position: [3.7 + (index % 5) * 0.65, Math.floor(index / 5) * 2] as Point,
  facing: index < 5 ? 0 : Math.PI,
}));
export function isMeeting(state: string) {
  return [
    "TRIGGERED",
    "AI_ANALYSIS",
    "AI_DEGRADED",
    "RISK_REVIEW",
    "BOSS_DECISION",
    "DISCORD",
  ].includes(state);
}
export function seatedFacing(index: number, state: string) {
  return isAttendingMeeting(index, state)
    ? meetingSeats[index].facing
    : Math.PI;
}
export function isAttendingMeeting(index: number, state: string) {
  return (
    isMeeting(state) &&
    (index !== characterIds.indexOf("boss") ||
      ["BOSS_DECISION", "DISCORD"].includes(state))
  );
}
/**
 * Eight analyst workstations use a centered 3-3-2 composition. The wider
 * aisles keep characters readable from the overview camera and preserve clear
 * walking routes between rows without adding any render-time cost.
 */
export const analystDesks: Point[] = [
  [-5.7, -1.85],
  [-3, -1.85],
  [-0.3, -1.85],
  [-5.7, 0.15],
  [-3, 0.15],
  [-0.3, 0.15],
  [-4.35, 2.15],
  [-1.65, 2.15],
];
export const desks: Point[] = [
  ...analystDesks,
  [6, -4], // Risk Office
  [6, 6], // Boss Office
];
// The rendered furniture and routing share these footprints. Door openings are
// real gaps, so actors can enter offices instead of crossing glass partitions.
export const partitions: Obstacle[] = [
  { x: 2.5, z: -3.9, w: 0.08, d: 5.2 },
  { x: 2.5, z: 2.2, w: 0.08, d: 2.4 },
  { x: 3.3, z: -1.6, w: 1.5, d: 0.08 },
  { x: 6.8, z: -1.6, w: 2.4, d: 0.08 },
  { x: 3.2, z: 4, w: 1.3, d: 0.08 },
  { x: 6.7, z: 4, w: 2.6, d: 0.08 },
];
export const furnishings: Obstacle[] = [
  { x: -6.2, z: 5.7, w: 2.1, d: 0.8 }, // Lobby sofa
  { x: -6.2, z: 4.7, w: 1.3, d: 0.45 }, // Coffee table
  { x: -7.65, z: 0, w: 0.7, d: 2.6 }, // Server racks
  { x: -2, z: 7, w: 3, d: 0.6 }, // Pantry
];
export const obstacles: Obstacle[] = [
  ...partitions,
  ...furnishings,
  ...desks.map(([x, z]) => ({ x, z, w: 1.6, d: 0.85 })),
  { x: 5, z: 1, w: 3, d: 1.4 },
];
export function walkable([x, z]: Point, geometry: Obstacle[] = obstacles) {
  return (
    x >= -8.25 &&
    x <= 8.25 &&
    z >= -7.25 &&
    z <= 7.25 &&
    !geometry.some(
      (o) =>
        Math.abs(x - o.x) < o.w / 2 + 0.2 && Math.abs(z - o.z) < o.d / 2 + 0.2,
    )
  );
}
export function segmentClear(
  a: Point,
  b: Point,
  geometry: Obstacle[] = obstacles,
) {
  const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05);
  for (let i = 0; i <= steps; i++) {
    const t = steps ? i / steps : 0;
    if (
      !walkable([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], geometry)
    )
      return false;
  }
  return true;
}
// A bounded grid graph avoids walls and desks; no route leaves the office floor.
export function planRoute(
  start: Point,
  end: Point,
  geometry: Obstacle[] = obstacles,
): Point[] {
  if (!walkable(start, geometry) || !walkable(end, geometry)) return [];
  if (segmentClear(start, end, geometry)) return [end];
  const snap = (p: Point): Point => [
    Math.round(p[0] * 4) / 4,
    Math.round(p[1] * 4) / 4,
  ];
  const a = snap(start),
    b = snap(end);
  if (!segmentClear(start, a, geometry) || !segmentClear(b, end, geometry))
    return [];
  const key = ([x, z]: Point) => `${x},${z}`;
  const queue: Point[] = [a];
  const previous = new Map<string, Point | null>([[key(a), null]]);
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    if (key(p) === key(b)) {
      const route: Point[] = [end];
      let current: Point | null = p;
      while (current) {
        route.push(current);
        current = previous.get(key(current)) ?? null;
      }
      route.reverse();
      const smooth: Point[] = [];
      let anchor = start;
      let index = 0;
      while (index < route.length) {
        let last = index;
        while (
          last + 1 < route.length &&
          segmentClear(anchor, route[last + 1], geometry)
        )
          last++;
        smooth.push(route[last]);
        anchor = route[last];
        index = last + 1;
      }
      return smooth;
    }
    for (const [dx, dz] of [
      [0.25, 0],
      [-0.25, 0],
      [0, 0.25],
      [0, -0.25],
    ]) {
      const next: Point = [p[0] + dx, p[1] + dz];
      if (!previous.has(key(next)) && segmentClear(p, next, geometry)) {
        previous.set(key(next), p);
        queue.push(next);
      }
    }
  }
  return [];
}

export type MovementPlan =
  | { mode: "walk"; route: Point[] }
  | { mode: "teleport"; destination: Point }
  | { mode: "stay" };

// Teleport is a last-resort rendering recovery only. Never teleport into blocked
// geometry or outside the office; an invalid destination leaves the actor put.
export function planMovement(
  start: Point,
  end: Point,
  geometry: Obstacle[] = obstacles,
): MovementPlan {
  const route = planRoute(start, end, geometry);
  if (route.length) return { mode: "walk", route };
  if (walkable(end, geometry)) return { mode: "teleport", destination: end };
  return { mode: "stay" };
}

export function destination(
  index: number,
  state: string,
  coffee = false,
): Point {
  if (isAttendingMeeting(index, state)) return meetingSeats[index].position;
  if (coffee) return [-2 + (index % 2) * 0.55, 5 + (index % 3) * 0.5];
  return [desks[index][0], desks[index][1] + 0.72];
}
