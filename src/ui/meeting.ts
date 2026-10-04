import type { CharacterId } from "../core/contracts";
import type { MeetingSnapshot } from "../core/meeting";

export interface MeetingPlayback {
  caseId: string;
  phase:
    | "gathering"
    | "waiting"
    | "boss-entering"
    | "speaking"
    | "returning"
    | "done";
  stage: string;
  shown: CharacterId[];
  speaker?: CharacterId;
  until: number;
}
export function advanceMeeting(
  previous: MeetingPlayback | undefined,
  meeting: MeetingSnapshot | null,
  now: number,
  reduced = false,
): MeetingPlayback | undefined {
  if (!meeting) return previous?.phase === "done" ? previous : undefined;
  if (!previous || previous.caseId !== meeting.case_id)
    return {
      caseId: meeting.case_id,
      phase: "gathering",
      stage: "AI_ANALYSIS",
      shown: [],
      until: now + (reduced ? 4000 : 14000),
    };
  if (previous.phase === "done") return previous;
  if (meeting.cancelled && previous.phase !== "returning")
    return {
      ...previous,
      phase: "returning",
      stage: "RETURN_TO_DESK",
      speaker: undefined,
      until: now + 8000,
    };
  if (now < previous.until) return previous;
  if (previous.phase === "returning")
    return { ...previous, phase: "done", speaker: undefined };
  const shown = previous.speaker
    ? [...previous.shown, previous.speaker]
    : previous.shown;
  const next = meeting.turns.find((turn) => !shown.includes(turn.character));
  if (next) {
    const stage =
      next.character === "boss"
        ? "BOSS_DECISION"
        : next.character === "risk"
          ? "RISK_REVIEW"
          : "AI_ANALYSIS";
    if (next.character === "boss" && previous.stage !== "BOSS_DECISION")
      return {
        ...previous,
        shown,
        speaker: undefined,
        stage,
        phase: "boss-entering",
        until: now + (reduced ? 2500 : 8000),
      };
    return {
      ...previous,
      shown,
      stage,
      phase: "speaking",
      speaker: next.character,
      until: now + 7000,
    };
  }
  if (meeting.finished && previous.stage !== "BOSS_DECISION")
    return {
      ...previous,
      shown,
      speaker: undefined,
      phase: "boss-entering",
      stage: "BOSS_DECISION",
      until: now + (reduced ? 2500 : 8000),
    };
  if (meeting.finished)
    return {
      ...previous,
      shown,
      speaker: undefined,
      phase: "returning",
      stage: "RETURN_TO_DESK",
      until: now + 8000,
    };
  if (previous.phase === "waiting" && !previous.speaker) return previous;
  return {
    ...previous,
    shown,
    speaker: undefined,
    phase: "waiting",
    until: now,
  };
}

export function speechExcerpt(summary: string) {
  const sentences = summary.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [summary];
  const excerpt = sentences.slice(0, 2).join("").trim();
  return excerpt.length > 190 ? excerpt.slice(0, 187).trimEnd() + "…" : excerpt;
}
