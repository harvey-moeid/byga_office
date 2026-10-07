export const UPPER_Y = 3.55;
export const EAST_OUTER_WALL_X = 8.7;
export const UPPER_EAST_WALL_X = 8.25;

export const STAIR_LAYOUT = {
  x: 9.45,
  width: 1.05,
  stepCount: 15,
  stepThickness: 0.16,
  stepDepth: 0.42,
  startY: 0.18,
  rise: 0.24,
  startZ: 6.3,
  run: 0.35,
  landingX: 9.05,
  landingZ: 1.15,
  landingWidth: 2.0,
  landingDepth: 1.6,
  landingThickness: 0.15,
  doorZ: 1.15,
  doorWidth: 1.6,
  doorHeight: 2.25,
} as const;

export const BOSS_OFFICE_LAYOUT = {
  x: 6,
  z: 6,
  deskWidth: 2.2,
  deskDepth: 0.95,
  rugWidth: 3.45,
  rugDepth: 2.55,
  featureWallZ: 7.32,
  featureWallWidth: 3.45,
  featureWallHeight: 1.8,
} as const;

export const MEETING_VIEW = {
  // Keep the camera below the mezzanine slab so the upper floor can never
  // occlude the meeting table or seated characters.
  camera: [7.7, 2.85, 3.35] as [number, number, number],
  target: [5, 0.95, 1] as [number, number, number],
} as const;
