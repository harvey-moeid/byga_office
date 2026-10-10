import { useCallback, useEffect, useRef, useState } from "react";
import type { CharacterId } from "../core/contracts";
import type { MeetingSnapshot, MeetingTurn } from "../core/meeting";
import { Link } from "react-router-dom";
import { authExpiredEvent, useData } from "./data";
import { advanceMeeting, speechExcerpt, type MeetingPlayback } from "./meeting";
import { roles } from "./shared";
import { characterPeekCopy, type CharacterPresence } from "./character-state";
import type { CharacterMotion } from "./character-motion";

export function useMeetingPresentation(render3D: boolean) {
  const data = useData<{ meeting: MeetingSnapshot | null }>(
    "/office/meeting",
    true,
  );
  const snapshot = data.data?.meeting ?? null;
  const [playback, setPlayback] = useState<MeetingPlayback>();
  const [detail, setDetail] = useState<MeetingTurn>();
  useEffect(() => {
    const clearPrivateDetail = () => setDetail(undefined);
    window.addEventListener(authExpiredEvent, clearPrivateDetail);
    return () =>
      window.removeEventListener(authExpiredEvent, clearPrivateDetail);
  }, []);
  const visibleSpeakers = useRef(new Set<CharacterId>());
  const onSpeechReady = useCallback((id: CharacterId, visible: boolean) => {
    const wasVisible = visibleSpeakers.current.has(id);
    if (visible) visibleSpeakers.current.add(id);
    else visibleSpeakers.current.delete(id);
    if (visible && !wasVisible)
      setPlayback((previous) =>
        previous?.phase === "speaking" && previous.speaker === id
          ? { ...previous, until: Date.now() + 7000 }
          : previous,
      );
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const advance = () => {
      if (document.hidden || (detail && !snapshot?.cancelled)) return;
      setPlayback((previous) =>
        render3D &&
        !snapshot?.cancelled &&
        previous?.phase === "speaking" &&
        previous.speaker &&
        !visibleSpeakers.current.has(previous.speaker)
          ? previous
          : advanceMeeting(previous, snapshot, Date.now(), media.matches),
      );
    };
    advance();
    const timer = setInterval(advance, 500);
    return () => clearInterval(timer);
  }, [snapshot, detail, render3D]);
  useEffect(() => setDetail(undefined), [snapshot?.case_id]);
  useEffect(() => {
    if (snapshot?.cancelled) setDetail(undefined);
  }, [snapshot?.cancelled]);
  const current =
    snapshot?.case_id === playback?.caseId
      ? snapshot?.turns.find((turn) => turn.character === playback?.speaker)
      : undefined;
  const active = !!playback && playback.phase !== "done" && !!snapshot;
  return {
    snapshot,
    playback,
    current,
    active,
    detail,
    openDetails: setDetail,
    error: data.error,
    retry: data.retry,
    onSpeechReady,
  };
}

export function CharacterPeekBubble({
  character,
  presence,
  group,
  motion,
  turn,
  onDetails,
}: {
  character: CharacterId;
  presence: CharacterPresence;
  group: string;
  motion?: CharacterMotion;
  turn?: MeetingTurn;
  onDetails: () => void;
}) {
  const voteClass = turn
    ? `vote-${turn.analysis.vote.toLowerCase().replaceAll("_", "-")}`
    : "";
  return (
    <button
      className={`meeting-bubble character-peek-bubble${character === "boss" ? " boss-bubble" : ""}`}
      data-vote={turn?.analysis.vote}
      aria-label={`Buka info ${roles[character]}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onDetails();
      }}
    >
      <strong>
        {roles[character]}
        <span className="character-peek-status">
          {presence.replaceAll("_", " ")}
        </span>
      </strong>
      <span className="character-peek-group">{group}</span>
      {turn ? (
        <>
          <span className={`speech-vote ${voteClass}`}>
            {turn.analysis.vote} · {turn.analysis.confidence}%
          </span>
          <span className="speech-text">
            {speechExcerpt(turn.analysis.summary)}
          </span>
        </>
      ) : (
        <span className="speech-text">
          {characterPeekCopy(presence, motion)}
        </span>
      )}
      <small>Ketuk untuk info karakter</small>
    </button>
  );
}

export function SpeechBubble({
  turn,
  onDetails,
}: {
  turn: MeetingTurn;
  onDetails: (turn: MeetingTurn) => void;
}) {
  return (
    <button
      className={`meeting-bubble${turn.character === "boss" ? " boss-bubble" : ""}`}
      data-vote={turn.analysis.vote}
      aria-label={`Baca percakapan ${roles[turn.character]}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onDetails(turn);
      }}
    >
      <strong>
        {roles[turn.character]}{" "}
        <span
          className={`speech-vote vote-${turn.analysis.vote
            .toLowerCase()
            .replaceAll("_", "-")}`}
        >
          {turn.analysis.vote} · {turn.analysis.confidence}%
        </span>
      </strong>
      <span className="speech-text">
        {speechExcerpt(turn.analysis.summary)}
      </span>
      <small>
        {turn.character === "boss" ? "Keputusan akhir · " : ""}Ketuk untuk
        detail
      </small>
    </button>
  );
}

export function MeetingStatus({
  presentation,
}: {
  presentation: ReturnType<typeof useMeetingPresentation>;
}) {
  const { playback, snapshot, active, current, error, retry } = presentation;
  const [expanded, setExpanded] = useState(false);
  const caseId = snapshot?.case_id;
  const returning = playback?.phase === "returning";
  useEffect(() => setExpanded(false), [caseId, returning]);
  if (!active && !error) return null;

  const label = returning
    ? snapshot?.cancelled
      ? "Meeting dihentikan · kembali ke meja"
      : "Meeting ditutup · kembali ke meja"
    : playback?.phase === "boss-entering"
      ? "Bos masuk untuk menutup meeting"
      : playback?.phase === "gathering"
        ? "Tim menuju ruang meeting"
        : current
          ? `${roles[current.character]} sedang berbicara`
          : "Menunggu hasil AI";
  const missing = snapshot?.unavailable ?? [];
  // A completed backend case may still be playing its visual discussion.
  // Compact only when the visual team is actually returning to their desks.
  const showSummary = returning || !!snapshot?.cancelled;
  return (
    <div
      className={`meeting-status${showSummary && !expanded ? " meeting-status-compact" : ""}`}
      role="status"
      aria-live="polite"
      data-case-id={caseId}
    >
      <div className="meeting-status-heading">
        <strong>{error ? "Percakapan belum dapat diperbarui" : label}</strong>
        {missing.length > 0 && (
          <button
            type="button"
            className="meeting-status-toggle"
            aria-expanded={expanded}
            aria-controls="meeting-status-details"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Tutup" : "Detail"}{" "}
            <span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span>
          </button>
        )}
      </div>
      {snapshot && (
        <small className="meeting-status-case">
          Case · {snapshot.case_id}
          {snapshot.cancelled ? ` · ${snapshot.status}` : ""}
        </small>
      )}
      {missing.length > 0 && (
        <>
          <div
            className="meeting-status-warning"
            aria-label={`${missing.length} hasil analis tidak tersedia`}
          >
            <span aria-hidden="true">⚠</span> {missing.length} hasil AI tidak
            tersedia
          </div>
          {expanded && (
            <div id="meeting-status-details" className="meeting-status-details">
              <p>
                Output gagal atau tidak lolos validasi. Hasil tersebut tidak
                dihitung sebagai suara.
              </p>
              <ul>
                {missing.map((id) => (
                  <li key={id}>
                    <strong>{roles[id]}</strong>
                    <span>
                      {snapshot?.failureReasons?.[id] ??
                        "Periksa detail case dan log provider"}
                    </span>
                  </li>
                ))}
              </ul>
              {caseId && (
                <Link to={`/cases/${encodeURIComponent(caseId)}`}>
                  Lihat detail case ↗
                </Link>
              )}
            </div>
          )}
        </>
      )}
      {error && (
        <button type="button" onClick={retry}>
          Coba lagi
        </button>
      )}
    </div>
  );
}

export function MeetingDetail({
  turn,
  caseId,
  onClose,
}: {
  turn?: MeetingTurn;
  caseId?: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (turn && !dialog.current?.open) dialog.current?.showModal();
    else if (!turn) dialog.current?.close();
  }, [turn]);
  return (
    <dialog
      className="meeting-detail"
      ref={dialog}
      onCancel={onClose}
      onClose={onClose}
      aria-labelledby="meeting-detail-title"
    >
      {turn && (
        <>
          <button
            className="close"
            autoFocus
            onClick={onClose}
            aria-label="Tutup percakapan"
          >
            ×
          </button>
          <small>{caseId}</small>
          <h2 id="meeting-detail-title">{roles[turn.character]}</h2>
          <p className="meeting-vote">
            {turn.analysis.vote} · Confidence {turn.analysis.confidence}%
          </p>
          <h3>Ringkasan</h3>
          <p>{turn.analysis.summary}</p>
          <h3>Penjelasan AI</h3>
          <p>{turn.analysis.reasoning}</p>
          {!!turn.analysis.evidence.length && (
            <>
              <h3>Evidence</h3>
              {turn.analysis.evidence.map((e, i) => (
                <p key={i}>
                  <strong>
                    {e.code} · {e.direction}
                  </strong>
                  <br />
                  {e.detail}
                </p>
              ))}
            </>
          )}
          {!!turn.analysis.risk_flags.length && (
            <>
              <h3>Risk flags</h3>
              <p>{turn.analysis.risk_flags.join(" · ")}</p>
            </>
          )}
          {turn.analysis.price_levels && (
            <p>
              Entry {turn.analysis.price_levels.entry} · Stop loss{" "}
              {turn.analysis.price_levels.stop_loss} · Take profit{" "}
              {turn.analysis.price_levels.take_profit}
            </p>
          )}
        </>
      )}
    </dialog>
  );
}
