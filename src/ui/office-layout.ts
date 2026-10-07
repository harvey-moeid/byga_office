export const UPPER_Y = 3.55;
export const UPPER_FLOOR_Y = UPPER_Y + 0.13;
export const EAST_OUTER_WALL_X = 8.7;
export const UPPER_EAST_WALL_X = 8.25;

export const STAIR_LAYOUT = {
  // Internal stairwell: fully inside the east wall/cutaway panel.
  x: 7.65,
  width: 0.95,
  stepCount: 16,
  stepThickness: 0.16,
  stepDepth: 0.38,
  startY: 0.12,
  rise: 0.232,
  startZ: 6.15,
  run: 0.3,
  landingX: 7.65,
  landingZ: 1.02,
  landingWidth: 1.28,
  landingDepth: 1.36,
  landingThickness: 0.15,
  openingWestX: 7.02,
  openingMinZ: 1.35,
  openingMaxZ: 6.55,
} as const;

export const GROUND_EXECUTIVE_STATION_LAYOUT = {
  x: 6,
  z: 6,
  deskWidth: 1.95,
  deskDepth: 0.9,
  rugWidth: 3.15,
  rugDepth: 2.3,
  featureWallZ: 7.32,
  featureWallWidth: 3.05,
  featureWallHeight: 1.65,
} as const;

export const BOSS_OFFICE_LAYOUT = {
  x: 4.72,
  z: 5.08,
  deskX: 4.72,
  deskZ: 5.18,
  seatX: 4.72,
  seatZ: 5.92,
  facing: Math.PI,
  roomMinX: 2.05,
  roomMaxX: 6.88,
  roomMinZ: 3.35,
  roomMaxZ: 6.82,
  deskWidth: 2.35,
  deskDepth: 1.0,
  rugWidth: 3.65,
  rugDepth: 2.45,
  featureWallZ: 6.58,
  featureWallWidth: 3.75,
  featureWallHeight: 1.95,
} as const;

export const UPPER_MEETING_LAYOUT = {
  x: 4.65,
  z: -2.2,
  tableWidth: 3.5,
  tableDepth: 1.35,
  rugWidth: 5.15,
  rugDepth: 4.35,
} as const;

export const UPPER_MEETING_SEATS = [
  { position: [3.25, -3.18] as const, facing: 0 },
  { position: [3.95, -3.18] as const, facing: 0 },
  { position: [4.65, -3.18] as const, facing: 0 },
  { position: [5.35, -3.18] as const, facing: 0 },
  { position: [6.05, -3.18] as const, facing: 0 },
  { position: [3.25, -1.22] as const, facing: Math.PI },
  { position: [3.95, -1.22] as const, facing: Math.PI },
  { position: [5.35, -1.22] as const, facing: Math.PI },
  { position: [6.05, -1.22] as const, facing: Math.PI },
  { position: [4.65, -1.22] as const, facing: Math.PI },
] as const;

export const LOWER_MEETING_VIEW = {
  camera: [5, 3.25, 11] as [number, number, number],
  target: [5, 0.95, 1] as [number, number, number],
} as const;

export const UPPER_MEETING_VIEW = {
  camera: [11.4, 7.15, 4.6] as [number, number, number],
  target: [4.65, UPPER_FLOOR_Y + 0.9, -2.2] as [number, number, number],
} as const;

export const LOWER_BOSS_VIEW = {
  camera: [10.7, 4.5, 9.6] as [number, number, number],
  target: [6, 0.9, 5.75] as [number, number, number],
} as const;

export const UPPER_BOSS_VIEW = {
  camera: [10.4, 7.25, 10.8] as [number, number, number],
  target: [BOSS_OFFICE_LAYOUT.x, UPPER_FLOOR_Y + 0.92, BOSS_OFFICE_LAYOUT.z] as [
    number,
    number,
    number,
  ],
} as const;
