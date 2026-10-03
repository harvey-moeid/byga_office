export type Quality = "low" | "medium" | "high";
export const profiles = {
  low: { dpr: 1, shadows: false, shadowSize: 256, decorative: false },
  medium: { dpr: 1.25, shadows: true, shadowSize: 512, decorative: true },
  high: { dpr: 1.75, shadows: true, shadowSize: 1024, decorative: true },
};
export function initialQuality(cores: number, memory = 8): Quality {
  return cores <= 4 || memory <= 4
    ? "low"
    : cores <= 8 || memory <= 8
      ? "medium"
      : "high";
}
export function adaptQuality(current: Quality, fps: number): Quality {
  if (fps >= 30) return current;
  return current === "high" ? "medium" : "low";
}
