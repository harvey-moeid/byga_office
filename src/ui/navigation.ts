export type Point = readonly [number, number];
export interface Obstacle {
  x: number;
  z: number;
  w: number;
  d: number;
}
export const rooms = [
  { label: "BYGA Lobby", x: -6, z: 5.5, w: 4, d: 3 },
  { label: "Analyst Floor", x: -3, z: 0, w: 9, d: 6 },
  { label: "Scanner Command", x: -6, z: -5, w: 4, d: 3 },
  { label: "Market Wall", x: 0, z: -5, w: 7, d: 3 },
  { label: "Risk Office", x: 6, z: -4, w: 4, d: 4 },
  { label: "War Room", x: 5, z: 1, w: 6, d: 5 },
  { label: "Boss Office", x: 6, z: 6, w: 4, d: 3 },
  { label: "Server / Data", x: -7, z: 0, w: 2, d: 3 },
  { label: "Lounge", x: -2, z: 5.5, w: 3, d: 3 },
  { label: "Musolla", x: 1, z: 6, w: 3, d: 3 },
];
export const desks: Point[] = [
  [-4, -2],
  [-1, -2],
  [-4, 1],
  [-1, 1],
  [-4, 3],
  [-1, 3],
  [6, -4],
  [6, 6],
];
export const obstacles: Obstacle[] = [
  ...rooms.map((r) => ({ x: r.x, z: r.z - r.d / 2, w: r.w, d: 0.08 })),
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
  prayer: boolean,
  coffee = false,
): Point {
  if (prayer)
    return [0.3 + (index % 4) * 0.45, 5.6 + Math.floor(index / 4) * 0.65];
  if (
    [
      "TRIGGERED",
      "AI_ANALYSIS",
      "AI_DEGRADED",
      "RISK_REVIEW",
      "BOSS_DECISION",
      "DISCORD",
    ].includes(state)
  )
    return [4 + (index % 4) * 0.65, Math.floor(index / 4) * 2];
  if (coffee) return [-2 + (index % 2) * 0.55, 5 + (index % 3) * 0.5];
  return [desks[index][0], desks[index][1] + 0.65];
}
