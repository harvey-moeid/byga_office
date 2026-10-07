import type { CharacterId } from "../core/contracts";
import type { MeetingSnapshot } from "../core/meeting";
import type { OfficeActivityKind } from "./office-activity";
import type { MeetingPlayback } from "./meeting";
import type { CharacterMotion } from "./character-motion";

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

export function characterPeekCopy(
  presence: CharacterPresence,
  motion?: CharacterMotion,
) {
  if (motion === "walk") {
    switch (presence) {
      case "WALKING TO MEETING":
        return "Menuju ruang meeting.";
      case "RETURNING":
        return "Kembali ke meja kerja.";
      case "COFFEE BREAK":
        return "Menuju area coffee break.";
      case "STRETCHING":
        return "Menuju area stretching.";
      case "DISCUSSION":
        return "Menuju rekan kerja untuk berdiskusi.";
      case "MARKET REVIEW":
        return "Menuju Market Wall untuk review.";
      case "ROAMING":
        return "Sedang berkeliling kantor.";
      case "DESK BREAK":
        return "Menuju area desk break.";
      case "GROUP DISCUSSION":
        return "Menuju diskusi bersama tim.";
      case "GROUP MARKET REVIEW":
        return "Menuju review market bersama tim.";
      case "BRIEFING":
        return "Menuju briefing.";
      case "MONITORING":
        return "Kembali ke meja kerja.";
      default:
        return "Sedang berjalan menuju aktivitas berikutnya.";
    }
  }

  switch (motion) {
    case "coffee":
      return "Sedang coffee break. Aktivitas visual ini tidak memanggil AI.";
    case "stretch":
      return "Sedang stretching sebentar sebelum kembali bekerja.";
    case "review":
      return "Sedang mengecek Market Wall.";
    case "talk":
      return presence === "BRIEFING"
        ? "Sedang mengikuti briefing."
        : "Sedang berdiskusi dengan tim.";
  }

  switch (presence) {
    case "MONITORING":
      return "Memantau market dari meja kerja.";
    case "SEATED":
      return "Duduk di ruang meeting dan menunggu giliran.";
    case "WAITING IN OFFICE":
      return "Menunggu tahap meeting berikutnya dari ruang kerja.";
    case "WAITING FOR OUTPUT":
      return "Menunggu output AI untuk case meeting aktif.";
    case "OUTPUT UNAVAILABLE":
      return "Output untuk case aktif tidak tersedia atau tidak lolos validasi.";
    case "SPEAKING":
      return "Sedang menyampaikan hasil analisis.";
    case "RETURNING":
      return "Kembali ke meja kerja.";
    case "COFFEE BREAK":
      return "Sedang coffee break. Aktivitas visual ini tidak memanggil AI.";
    case "STRETCHING":
      return "Sedang stretching sebentar sebelum kembali bekerja.";
    case "DISCUSSION":
    case "GROUP DISCUSSION":
      return "Sedang berdiskusi dengan tim.";
    case "MARKET REVIEW":
    case "GROUP MARKET REVIEW":
      return "Sedang mengecek Market Wall.";
    case "ROAMING":
      return "Sedang berkeliling kantor.";
    case "DESK BREAK":
      return "Sedang mengambil desk break singkat.";
    case "BRIEFING":
      return "Sedang mengikuti briefing.";
    case "WALKING TO MEETING":
      return "Menuju ruang meeting.";
    default:
      return "Status karakter mengikuti aktivitas kantor yang sedang berlangsung.";
  }
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
