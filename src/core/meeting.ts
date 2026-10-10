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
  prices_private?: boolean;
  turns: MeetingTurn[];
  unavailable: CharacterId[];
  failureReasons?: Partial<Record<CharacterId, string>>;
}

// Publish only validated character output, never prompts, provider metadata or
// internal case snapshots. Missing/failed output does not become invented speech.
export function meetingTurns(snapshots: string[]) {
  const turns: MeetingTurn[] = [];
  const unavailable: CharacterId[] = [];
  const failureReasons: Partial<Record<CharacterId, string>> = {};
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
    if (saved.status !== "SUCCESS" || !parsed.success) {
      unavailable.push(character);
      failureReasons[character] = meetingFailureReason(saved, parsed.success);
    } else turns.push({ character, analysis: parsed.data });
  }
  return { turns, unavailable, failureReasons };
}

/**
 * Public, bounded failure categories only. Never return prompts, raw provider
 * responses, tokens, model credentials or internal validation strings.
 */
export function meetingFailureReason(
  saved: { status?: string; validationErrors?: unknown },
  schemaValid: boolean,
): string {
  const errors = Array.isArray(saved.validationErrors)
    ? saved.validationErrors.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  if (errors.some((value) => /PROVIDER_HTTP_402/.test(value)))
    return "Provider meminta pembayaran atau kredit (HTTP 402)";
  if (errors.some((value) => /PROVIDER_HTTP_401|PROVIDER_HTTP_403/.test(value)))
    return "Autentikasi atau akses provider ditolak";
  if (errors.some((value) => /PROVIDER_HTTP_404/.test(value)))
    return "Model atau endpoint tidak ditemukan (HTTP 404)";
  if (errors.some((value) => /PROVIDER_HTTP_400/.test(value)))
    return "Permintaan model ditolak (HTTP 400)";
  if (errors.includes("PROVIDER_NOT_CONFIGURED"))
    return "Provider belum dikonfigurasi";
  if (errors.some((value) => /SEMANTIC_INVALID|validation|schema/i.test(value)))
    return "Output AI tidak memenuhi aturan validasi";
  if (
    saved.status === "TIMEOUT" ||
    errors.some((value) => /timeout|aborted/i.test(value))
  )
    return "Provider tidak merespons sebelum batas waktu";
  if (!schemaValid && saved.status === "SUCCESS")
    return "Output AI tidak sesuai format";
  return "Tidak ada output valid; periksa log provider di Admin";
}
