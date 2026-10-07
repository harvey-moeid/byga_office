import type { OfficeActivity } from "./office-activity";

export type CharacterMotion =
  | "idle"
  | "walk"
  | "sit"
  | "type"
  | "talk"
  | "meeting-talk"
  | "coffee"
  | "stretch"
  | "review";

export function showsCoffeeCup(motion: CharacterMotion) {
  return motion === "coffee";
}

export function characterMotion({
  walking,
  sitting,
  meeting,
  speaking,
  atActivity,
  activityKind,
}: {
  walking: boolean;
  sitting: boolean;
  meeting: boolean;
  speaking: boolean;
  atActivity: boolean;
  activityKind?: OfficeActivity["kind"];
}): CharacterMotion {
  if (walking) return "walk";
  if (atActivity) {
    if (activityKind === "roam") return "walk";
    if (activityKind === "stretch" || activityKind === "desk-break")
      return "stretch";
    if (activityKind === "coffee" || activityKind === "coffee-break")
      return "coffee";
    if (
      activityKind === "market-review" ||
      activityKind === "group-market-review"
    )
      return "review";
    if (
      activityKind === "chat" ||
      activityKind === "group-chat" ||
      activityKind === "briefing"
    )
      return "talk";
    return "idle";
  }
  if (sitting) return meeting ? (speaking ? "meeting-talk" : "sit") : "type";
  return "idle";
}
