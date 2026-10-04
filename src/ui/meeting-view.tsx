import { useCallback, useEffect, useRef, useState } from "react";
import type { CharacterId } from "../core/contracts";
import type { MeetingSnapshot, MeetingTurn } from "../core/meeting";
import { useData } from "./data";
import { advanceMeeting, speechExcerpt, type MeetingPlayback } from "./meeting";
import { roles } from "./shared";

export function useMeetingPresentation(render3D: boolean) {
  const data = useData<{ meeting: MeetingSnapshot | null }>(
    "/office/meeting",
    true,
  );
  const snapshot = data.data?.meeting ?? null;
  const [playback, setPlayback] = useState<MeetingPlayback>();
  const [detail, setDetail] = useState<MeetingTurn>();
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
      if (document.hidden || detail) return;
      setPlayback((previous) =>
        render3D &&
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
      aria-label={`Baca percakapan ${roles[turn.character]}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onDetails(turn);
      }}
    >
      <strong>
        {roles[turn.character]} <span>{turn.analysis.vote}</span>
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
  if (!active && !error) return null;
  const label =
    playback?.phase === "returning"
      ? "Meeting ditutup · kembali ke meja"
      : playback?.phase === "boss-entering"
        ? "Bos masuk untuk menutup meeting"
        : playback?.phase === "gathering"
          ? "Tim menuju ruang meeting"
          : current
            ? `${roles[current.character]} sedang berbicara`
            : "Menunggu hasil AI";
  return (
    <div className="meeting-status" role="status" aria-live="polite">
      <strong>{error ? "Percakapan belum dapat diperbarui" : label}</strong>
      {snapshot && <small>Hasil case · {snapshot.case_id}</small>}
      {snapshot?.cancelled && (
        <small>Case dihentikan · {snapshot.status}</small>
      )}
      {!!snapshot?.unavailable.length && (
        <small>
          Hasil tidak tersedia:{" "}
          {snapshot.unavailable.map((id) => roles[id]).join(", ")}
        </small>
      )}
      {error && <button onClick={retry}>Coba lagi</button>}
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
