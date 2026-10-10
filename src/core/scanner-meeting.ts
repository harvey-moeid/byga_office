import type {
  AnalysisGroup,
  CharacterId,
  Direction,
  GroupSnapshot,
  TradeDirection,
} from "./contracts";
import type { MeetingSnapshot, ScannerMeetingTurn } from "./meeting";

export const CRON_INTERVAL_MS = 300_000;
export type ScannerReviewReason =
  | "NO_CONSENSUS"
  | "DIRECTION_CONFLICT"
  | "AI_QUEUED"
  | "CANDLE_UNCHANGED"
  | "COOLDOWN"
  | "AI_BUDGET"
  | "MARKET_UNAVAILABLE"
  | "AI_START_FAILED";
export interface ScannerReview {
  id: string;
  scheduled_at: number;
  candle_timestamp: number | null;
  minimum: number;
  direction: TradeDirection | null;
  reason: ScannerReviewReason;
  groups: Pick<GroupSnapshot, "group" | "direction" | "strength" | "reasons">[];
}
export const scannerGroupLabels: Record<AnalysisGroup, string> = {
  SMC_ICT: "SMC / ICT",
  INDICATORS: "Indicators",
  VOLUME: "Volume",
  DERIVATIVES_POSITIONING: "Derivatives / Positioning",
};
const speakers: Record<AnalysisGroup, CharacterId> = {
  SMC_ICT: "structure",
  INDICATORS: "trend",
  VOLUME: "volume",
  DERIVATIVES_POSITIONING: "derivatives",
};
export function scannerReviewSummary(review: ScannerReview) {
  const counts = { BUY: 0, SELL: 0, NONE: 0 };
  for (const group of review.groups) counts[group.direction]++;
  const tally = `${counts.BUY} BUY, ${counts.SELL} SELL, ${counts.NONE} netral. Minimal ${review.minimum} grup searah.`;
  const reason: Record<ScannerReviewReason, string> = {
    NO_CONSENSUS:
      "Belum cukup grup searah. Meeting ini membahas scanner tanpa memanggil AI.",
    DIRECTION_CONFLICT:
      "Dukungan BUY dan SELL berimbang. Konflik arah dibahas tanpa memanggil AI.",
    AI_QUEUED: `Syarat ${review.direction} terpenuhi. Analisis AI dilanjutkan untuk candle ini.`,
    CANDLE_UNCHANGED:
      "Belum ada candle M5 tertutup yang baru. AI tidak dipanggil ulang untuk candle yang sama.",
    COOLDOWN:
      "Arah ini masih dalam cooldown yang dikonfigurasi. AI tidak dipanggil.",
    AI_BUDGET:
      "Batas case AI harian tercapai. Hasil scanner dibahas tanpa memanggil AI.",
    MARKET_UNAVAILABLE:
      "Data pasar tertutup belum tersedia atau tidak lolos validasi. Scanner dan AI menunggu data yang valid.",
    AI_START_FAILED:
      "Analisis AI belum dapat dimulai. Hasil scanner tetap tersedia untuk dibahas.",
  };
  return review.reason === "MARKET_UNAVAILABLE"
    ? reason[review.reason]
    : `${tally} ${reason[review.reason]}`;
}
export function scannerMeeting(review: ScannerReview): MeetingSnapshot {
  const summary = scannerReviewSummary(review);
  const turns: ScannerMeetingTurn[] = review.groups.map((group) => ({
    character: speakers[group.group],
    source: "SCANNER",
    scanner: {
      group: group.group,
      direction: group.direction,
      strength: group.strength,
      summary: `${scannerGroupLabels[group.group]}: ${group.direction === "NONE" ? "belum ada arah terkonfirmasi" : group.direction}. ${group.reasons.join(". ")}`,
      reasoning:
        group.reasons.join("\n") || "Grup belum memberikan alasan tambahan.",
    },
  }));
  for (const character of ["risk", "boss"] as const)
    turns.push({
      character,
      source: "SCANNER",
      scanner: { direction: "NONE" as Direction, summary, reasoning: summary },
    });
  return {
    case_id: review.id,
    kind: "SCANNER",
    scan: review,
    status: "SCANNER_REVIEW",
    finished: true,
    cancelled: false,
    turns,
    unavailable: [],
  };
}
