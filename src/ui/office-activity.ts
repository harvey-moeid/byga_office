import { characterIds, type CharacterId } from "../core/contracts";
import type { Point } from "./navigation";

export type OfficeActivityKind =
  | "coffee"
  | "stretch"
  | "chat"
  | "market-review"
  | "roam"
  | "desk-break"
  | "group-chat"
  | "coffee-break"
  | "group-market-review"
  | "briefing";

export interface OfficeActivity {
  kind: OfficeActivityKind;
  destination: Point;
  facing: number;
  durationMs: number;
  group: boolean;
}

export interface OfficeActivityEvent {
  mode: "individual" | "group";
  assignments: Partial<Record<CharacterId, OfficeActivity>>;
  durationMs: number;
}

export const FIRST_ACTIVITY_DELAY = { min: 30_000, max: 60_000 } as const;
export const NEXT_ACTIVITY_DELAY = { min: 240_000, max: 360_000 } as const;
export const ACTIVITY_TRAVEL_BUFFER_MS = 15_000;
export const ACTIVITY_TRAVEL_TIMEOUT_MS = 90_000;

type RandomSource = () => number;
type Range = readonly [number, number];

const individualKinds: OfficeActivityKind[] = [
  "coffee",
  "stretch",
  "chat",
  "market-review",
  "roam",
  "desk-break",
];
const groupKinds: OfficeActivityKind[] = [
  "group-chat",
  "coffee-break",
  "group-market-review",
  "briefing",
];

const durations: Record<OfficeActivityKind, Range> = {
  coffee: [30_000, 60_000],
  stretch: [10_000, 20_000],
  chat: [20_000, 40_000],
  "market-review": [20_000, 45_000],
  roam: [25_000, 50_000],
  "desk-break": [15_000, 30_000],
  "group-chat": [25_000, 45_000],
  "coffee-break": [35_000, 60_000],
  "group-market-review": [30_000, 50_000],
  briefing: [20_000, 40_000],
};

const individualSpots: Record<
  Exclude<OfficeActivityKind, "group-chat" | "coffee-break" | "group-market-review" | "briefing">,
  Point[]
> = {
  coffee: [
    [-3, 5.4],
    [-1.2, 5.3],
    [0, 5.3],
    [1.2, 5.2],
    [-0.4, 4.5],
    [-3.4, 4.5],
  ],
  stretch: [
    [-5, -1],
    [-2, -1],
    [-5, 1],
    [-2, 1],
    [-5, 4],
    [-2, 4],
    [5, -3],
    [5, 5],
  ],
  chat: [
    [-5, -1],
    [-2, -1],
    [-5, 1],
    [-2, 1],
    [-5, 4],
    [-2, 4],
  ],
  "market-review": [
    [-2, -3.7],
    [-1.2, -3.7],
    [-0.4, -3.7],
    [0.4, -3.7],
    [1.2, -3.7],
    [2, -3.7],
  ],
  roam: [
    [-6, 2],
    [-6.8, -2],
    [1, 5],
    [1, -1],
    [0, 1],
    [0, 4],
    [-3, 4.5],
    [1, -4.5],
  ],
  "desk-break": [
    [-5, -1],
    [-2, -1],
    [-5, 1],
    [-2, 1],
    [-5, 4],
    [-2, 4],
    [5, -3],
    [5, 5],
  ],
};

const groupPlans: Record<
  "group-chat" | "coffee-break" | "group-market-review" | "briefing",
  { center: Point; spots: Point[] }
> = {
  "group-chat": {
    // Keep spontaneous discussions in the open east aisle, not between desks.
    center: [0.9, 1.5],
    spots: [
      [0.8, 0.7],
      [1.2, 0.7],
      [1.3, 1.4],
      [1.2, 2.2],
      [0.8, 2.5],
      [0.4, 1.7],
    ],
  },
  "coffee-break": {
    center: [-1.2, 5.3],
    spots: [
      [-3.2, 5.1],
      [-2.4, 5.1],
      [-1.6, 5.1],
      [-0.8, 5.1],
      [0, 5.1],
      [0.8, 5.1],
    ],
  },
  "group-market-review": {
    center: [0, -6.6],
    spots: [
      [-2, -3.7],
      [-1.2, -3.7],
      [-0.4, -3.7],
      [0.4, -3.7],
      [1.2, -3.7],
      [2, -3.7],
    ],
  },
  briefing: {
    // Use the quiet west perimeter so a briefing never blocks the back desk row.
    center: [-6.5, 2.1],
    spots: [
      [-6.9, 1.7],
      [-6.5, 1.7],
      [-6.1, 1.7],
      [-6.9, 2.5],
      [-6.5, 2.5],
      [-6.1, 2.5],
    ],
  },
};

function sample(random: RandomSource) {
  return Math.min(0.999999999, Math.max(0, random()));
}

function integer(min: number, max: number, random: RandomSource) {
  return min + Math.floor(sample(random) * (max - min + 1));
}

function pick<T>(items: readonly T[], random: RandomSource) {
  return items[Math.floor(sample(random) * items.length)];
}

function shuffle<T>(items: readonly T[], random: RandomSource) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(sample(random) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function facingToward(from: Point, target: Point) {
  return Math.atan2(target[0] - from[0], target[1] - from[1]);
}

function activityDuration(kind: OfficeActivityKind, random: RandomSource) {
  const [min, max] = durations[kind];
  return integer(min, max, random);
}

function individualFacing(kind: OfficeActivityKind, spot: Point) {
  if (kind === "coffee") return 0;
  if (kind === "market-review") return Math.PI;
  if (kind === "chat") return facingToward(spot, [-3, 1]);
  return Math.PI;
}

export function activityDelayMs(first: boolean, random: RandomSource = Math.random) {
  const range = first ? FIRST_ACTIVITY_DELAY : NEXT_ACTIVITY_DELAY;
  return integer(range.min, range.max, random);
}

export function createOfficeActivityEvent(
  random: RandomSource = Math.random,
): OfficeActivityEvent {
  const count = integer(2, 6, random);
  const participants = shuffle(characterIds, random).slice(0, count);
  const group = sample(random) < 0.38;
  const assignments: Partial<Record<CharacterId, OfficeActivity>> = {};

  if (group) {
    const kind = pick(groupKinds, random) as keyof typeof groupPlans;
    const plan = groupPlans[kind];
    const durationMs = activityDuration(kind, random);
    participants.forEach((id, index) => {
      const destination = plan.spots[index % plan.spots.length];
      assignments[id] = {
        kind,
        destination,
        facing: facingToward(destination, plan.center),
        durationMs,
        group: true,
      };
    });
    return { mode: "group", assignments, durationMs };
  }

  let longest = 0;
  const occupied = new Set<string>();
  participants.forEach((id) => {
    const kind = pick(individualKinds, random) as keyof typeof individualSpots;
    const spots = individualSpots[kind];
    const available = spots.filter((spot) => !occupied.has(spot.join(",")));
    const destination = pick(available.length ? available : spots, random);
    occupied.add(destination.join(","));
    const durationMs = activityDuration(kind, random);
    longest = Math.max(longest, durationMs);
    assignments[id] = {
      kind,
      destination,
      facing: individualFacing(kind, destination),
      durationMs,
      group: false,
    };
  });
  return { mode: "individual", assignments, durationMs: longest };
}

export function activityDestinations() {
  return [
    ...Object.values(individualSpots).flat(),
    ...Object.values(groupPlans).flatMap((plan) => plan.spots),
  ].filter(
    (point, index, points) =>
      points.findIndex((candidate) => candidate.join(",") === point.join(",")) ===
      index,
  );
}
