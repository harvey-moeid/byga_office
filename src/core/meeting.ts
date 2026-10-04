import {
  analysisSchema,
  characterIds,
  type Analysis,
  type CharacterId,
} from "./contracts";

export interface MeetingTurn {
  character: CharacterId;
  analysis: Analysis;
}
export interface MeetingSnapshot {
  case_id: string;
  status: string;
  finished: boolean;
  cancelled: boolean;
  turns: MeetingTurn[];
  unavailable: CharacterId[];
}

// Publish only validated character output, never prompts, provider metadata or
// internal case snapshots. Missing/failed output does not become invented speech.
export function meetingTurns(snapshots: string[]) {
  const turns: MeetingTurn[] = [];
  const unavailable: CharacterId[] = [];
  const results = snapshots.flatMap((text) => {
    try {
      return [JSON.parse(text)];
    } catch {
      return [];
    }
  });
  for (const character of characterIds) {
    const saved = results.find((result) => result?.id === character);
    if (!saved) continue;
    const parsed = analysisSchema.safeParse(saved.output);
    if (saved.status !== "SUCCESS" || !parsed.success)
      unavailable.push(character);
    else turns.push({ character, analysis: parsed.data });
  }
  return { turns, unavailable };
}
