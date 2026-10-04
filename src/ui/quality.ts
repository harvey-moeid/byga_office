export type Quality = "low" | "medium" | "high" | "ultra";
export type QualityMode = "auto" | Quality;

export const qualityModes: QualityMode[] = [
  "auto",
  "low",
  "medium",
  "high",
  "ultra",
];

export const profiles: Record<
  Quality,
  {
    dpr: number;
    shadows: boolean;
    shadowSize: number;
    decorative: boolean;
  }
> = {
  low: { dpr: 1, shadows: false, shadowSize: 256, decorative: false },
  medium: { dpr: 1.25, shadows: true, shadowSize: 512, decorative: true },
  high: { dpr: 1.75, shadows: true, shadowSize: 1024, decorative: true },
  ultra: { dpr: 2, shadows: true, shadowSize: 2048, decorative: true },
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
  return current === "ultra"
    ? "high"
    : current === "high"
      ? "medium"
      : "low";
}

export function parseQualityMode(value: string | null): QualityMode {
  return qualityModes.includes(value as QualityMode)
    ? (value as QualityMode)
    : "auto";
}
