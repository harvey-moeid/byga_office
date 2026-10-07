import type { CharacterId } from "../core/contracts";
import type { MeetingSnapshot } from "../core/meeting";
import type { OfficeActivityKind } from "./office-activity";
import type { MeetingPlayback } from "./meeting";

export const characterGroupLabels: Record<CharacterId, string> = {
  trend: "SMC / ICT",
  structure: "SMC / ICT",
  momentum: "Indicators",
  liquidity: "Indicators",
  volume: "Volume",
  quant: "Volume",
  derivatives: "Derivatives / Positioning",
  positioning: "Derivatives / Positioning",
  risk: "Risk authority",
  boss: "Final authority",
};

export const activityLabels: Record<OfficeActivityKind, string> = {
  coffee: "COFFEE BREAK",
  stretch: "STRETCHING",
  chat: "DISCUSSION",
  "market-review": "MARKET REVIEW",
  roam: "ROAMING",
  "desk-break": "DESK BREAK",
  "group-chat": "GROUP DISCUSSION",
  "coffee-break": "COFFEE BREAK",
  "group-market-review": "GROUP MARKET REVIEW",
  briefing: "BRIEFING",
};

export type CharacterPresence =
  | "MONITORING"
  | "WALKING TO MEETING"
  | "WAITING IN OFFICE"
  | "WAITING FOR OUTPUT"
  | "SEATED"
  | "SPEAKING"
  | "RETURNING"
  | "OUTPUT UNAVAILABLE"
  | (typeof activityLabels)[OfficeActivityKind];

export function canOpenSeatedCharacterBubble({
  seated,
  hasActivity,
}: {
  seated: boolean;
  hasActivity: boolean;
}) {
  return seated && !hasActivity;
}

export function characterPresence(
  id: CharacterId,
  {
    playback,
    snapshot,
    activity,
  }: {
    playback?: MeetingPlayback;
    snapshot?: MeetingSnapshot | null;
    activity?: OfficeActivityKind;
  },
): CharacterPresence {
  if (!playback || !snapshot || playback.phase === "done")
    return activity ? activityLabels[activity] : "MONITORING";

  if (snapshot.unavailable.includes(id)) return "OUTPUT UNAVAILABLE";
  if (playback.phase === "returning") return "RETURNING";

  const isBoss = id === "boss";
  const hasOutput = snapshot.turns.some((turn) => turn.character === id);

  if (playback.phase === "gathering")
    return isBoss ? "WAITING IN OFFICE" : "WALKING TO MEETING";

  if (playback.phase === "boss-entering")
    return isBoss ? "WALKING TO MEETING" : "SEATED";

  if (playback.phase === "speaking") {
    if (playback.speaker === id) return "SPEAKING";
    if (isBoss && playback.stage !== "BOSS_DECISION") return "WAITING IN OFFICE";
    return hasOutput ? "SEATED" : "WAITING FOR OUTPUT";
  }

  if (playback.phase === "waiting") {
    if (isBoss && playback.stage !== "BOSS_DECISION") return "WAITING IN OFFICE";
    return hasOutput ? "SEATED" : "WAITING FOR OUTPUT";
  }

  return activity ? activityLabels[activity] : "MONITORING";
}
