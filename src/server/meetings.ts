import {
  meetingTurns,
  participantsFromContext,
  type MeetingSnapshot,
} from "../core/meeting";
import {
  CRON_INTERVAL_MS,
  scannerMeeting,
  type ScannerReview,
} from "../core/scanner-meeting";
import type { Env } from "./env";
import { redactPrivateAnalysis } from "./publication";

interface MeetingCase {
  uuid: string;
  id: string;
  status: string;
  created_at: number;
  context: string;
}
interface ReviewRow {
  id: string;
  snapshot: string;
  case_uuid: string | null;
  created_at: number;
}
async function caseMeeting(
  env: Env,
  current: MeetingCase,
  visible: boolean,
  scan?: ScannerReview,
): Promise<MeetingSnapshot> {
  const outputs = await env.DB.prepare(
    "SELECT snapshot FROM ai_character_outputs WHERE case_uuid=?",
  )
    .bind(current.uuid)
    .all<{ snapshot: string }>();
  const participants = participantsFromContext(current.context);
  const turns = meetingTurns(
    outputs.results.map((row) => row.snapshot),
    participants,
  );
  const cancelled = [
    "FAILED",
    "CONFIG_CHANGED",
    "STALE",
    "CANCELLED",
    "DIRECTION_CHANGED",
  ].includes(current.status);
  return {
    case_id: current.id,
    kind: "AI",
    participants,
    ...(scan ? { scan } : {}),
    status: current.status,
    finished:
      cancelled || ["COMPLETED", "NO_CONSENSUS"].includes(current.status),
    cancelled,
    ...turns,
    prices_private: !visible,
    turns: turns.turns.map((turn) => ({
      ...turn,
      analysis: visible ? turn.analysis : redactPrivateAnalysis(turn.analysis),
    })),
  };
}
async function reviewMeeting(env: Env, row: ReviewRow, visible: boolean) {
  const review = JSON.parse(row.snapshot) as ScannerReview;
  if (row.case_uuid) {
    const current = await env.DB.prepare(
      "SELECT uuid,id,status,created_at,context FROM cases WHERE uuid=? AND mode='LIVE' AND NOT EXISTS (SELECT 1 FROM history_deletions h WHERE h.case_uuid=cases.uuid)",
    )
      .bind(row.case_uuid)
      .first<MeetingCase>();
    if (current) return caseMeeting(env, current, visible, review);
  }
  return scannerMeeting(review);
}
export async function readOfficeMeetings(
  env: Env,
  visible: boolean,
  requestedId?: string,
) {
  const active = await env.DB.prepare(
    "SELECT uuid,id,status,created_at,context FROM cases WHERE mode='LIVE' AND NOT EXISTS (SELECT 1 FROM history_deletions h WHERE h.case_uuid=cases.uuid) AND status IN ('REVALIDATING','AI_ANALYSIS','AI_DEGRADED','RISK_REVIEW','BOSS_REVIEW','SIGNAL_CREATED') ORDER BY created_at LIMIT 1",
  ).first<MeetingCase>();
  const latestReview = await env.DB.prepare(
    "SELECT * FROM scanner_meetings WHERE NOT EXISTS (SELECT 1 FROM history_deletions h WHERE h.case_uuid=scanner_meetings.case_uuid) AND created_at>=? ORDER BY scheduled_at DESC LIMIT 1",
  )
    .bind(Date.now() - CRON_INTERVAL_MS)
    .first<ReviewRow>();
  let meeting: MeetingSnapshot | null = null;
  if (active) {
    const linked = await env.DB.prepare(
      "SELECT * FROM scanner_meetings WHERE NOT EXISTS (SELECT 1 FROM history_deletions h WHERE h.case_uuid=scanner_meetings.case_uuid) AND case_uuid=? ORDER BY scheduled_at DESC LIMIT 1",
    )
      .bind(active.uuid)
      .first<ReviewRow>();
    meeting = await caseMeeting(
      env,
      active,
      visible,
      linked ? (JSON.parse(linked.snapshot) as ScannerReview) : undefined,
    );
  } else {
    const recent = await env.DB.prepare(
      "SELECT uuid,id,status,created_at,context FROM cases WHERE mode='LIVE' AND NOT EXISTS (SELECT 1 FROM history_deletions h WHERE h.case_uuid=cases.uuid) AND status IN ('COMPLETED','NO_CONSENSUS','FAILED','CONFIG_CHANGED','STALE','DIRECTION_CHANGED') AND updated_at>=? ORDER BY created_at DESC LIMIT 1",
    )
      .bind(Date.now() - 180_000)
      .first<MeetingCase>();
    meeting =
      recent && (!latestReview || recent.created_at > latestReview.created_at)
        ? await caseMeeting(env, recent, visible)
        : latestReview
          ? await reviewMeeting(env, latestReview, visible)
          : null;
  }
  if (!requestedId) return { meeting };
  let requested: MeetingSnapshot | null = null;
  if (meeting?.case_id === requestedId) requested = meeting;
  else {
    const current = await env.DB.prepare(
      "SELECT uuid,id,status,created_at,context FROM cases WHERE id=? AND mode='LIVE' AND NOT EXISTS (SELECT 1 FROM history_deletions h WHERE h.case_uuid=cases.uuid)",
    )
      .bind(requestedId)
      .first<MeetingCase>();
    if (current) {
      const linked = await env.DB.prepare(
        "SELECT * FROM scanner_meetings WHERE NOT EXISTS (SELECT 1 FROM history_deletions h WHERE h.case_uuid=scanner_meetings.case_uuid) AND case_uuid=? ORDER BY scheduled_at DESC LIMIT 1",
      )
        .bind(current.uuid)
        .first<ReviewRow>();
      requested = await caseMeeting(
        env,
        current,
        visible,
        linked ? (JSON.parse(linked.snapshot) as ScannerReview) : undefined,
      );
    } else {
      const review = await env.DB.prepare(
        "SELECT * FROM scanner_meetings WHERE NOT EXISTS (SELECT 1 FROM history_deletions h WHERE h.case_uuid=scanner_meetings.case_uuid) AND id=?",
      )
        .bind(requestedId)
        .first<ReviewRow>();
      if (review) requested = await reviewMeeting(env, review, visible);
    }
  }
  return { meeting, requested_meeting: requested };
}
