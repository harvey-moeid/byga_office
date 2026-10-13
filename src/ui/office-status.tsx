import { useEffect, useState } from "react";
import { InfoDialog, Notice, roles } from "./shared";
import { MeetingStatus, type useMeetingPresentation } from "./meeting-view";
import { useOnline } from "./data";

export function OfficeStatus({
  office,
  error,
  retry,
  marketUnavailable,
  development,
  presentation,
}: {
  office: string;
  error?: string;
  retry: () => void;
  marketUnavailable: boolean;
  development?: boolean;
  presentation: ReturnType<typeof useMeetingPresentation>;
}) {
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string>();
  const issue = !online
    ? "Koneksi terputus"
    : error
      ? "Status kantor belum diperbarui"
      : presentation.error
        ? "Percakapan belum diperbarui"
        : marketUnavailable
          ? "Data pasar belum tersedia"
          : undefined;
  useEffect(() => {
    setToast(issue);
    if (!issue) return;
    const timer = setTimeout(() => setToast(undefined), 4500);
    return () => clearTimeout(timer);
  }, [issue]);
  const phase = presentation.playback?.phase;
  const meetingLabel = !presentation.active
    ? undefined
    : phase === "gathering"
      ? "Tim menuju ruang meeting"
      : phase === "boss-entering"
        ? "Bos masuk untuk menutup meeting"
        : phase === "returning"
          ? presentation.snapshot?.cancelled
            ? "Meeting dihentikan · kembali ke meja"
            : "Meeting ditutup · kembali ke meja"
          : presentation.current
            ? `${roles[presentation.current.character]} sedang berbicara`
            : presentation.snapshot?.kind === "SCANNER"
              ? "Membahas hasil scanner tanpa AI"
              : "Menunggu hasil AI";
  const warning =
    !!issue ||
    (presentation.active && !!presentation.snapshot?.unavailable.length);
  return (
    <div className="office-status">
      <button
        type="button"
        className={`home-state office-status-trigger${presentation.active ? " meeting-status" : ""}`}
        data-case-id={
          presentation.active ? presentation.snapshot?.case_id : undefined
        }
        data-warning={warning}
        aria-label="Buka status kantor"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setToast(undefined);
          setOpen(true);
        }}
      >
        <span className="dot" aria-hidden="true" />
        <span>{!online ? "OFFLINE" : office.replaceAll("_", " ")}</span>
        {warning && (
          <span
            className="office-status-warning"
            aria-label="Status perlu perhatian"
          >
            !
          </span>
        )}
        <span className="office-status-chevron" aria-hidden="true">
          ⌄
        </span>
      </button>
      {meetingLabel && (
        <span className="office-meeting-caption" aria-live="polite">
          {meetingLabel}
        </span>
      )}
      {toast && !open && (
        <span className="office-status-toast" role="status">
          {toast} · ketuk status untuk detail
        </span>
      )}
      {open && (
        <InfoDialog
          titleId="office-status-title"
          onClose={() => setOpen(false)}
        >
          <div className="office-status-panel">
            <div className="office-status-panel-heading">
              <div>
                <span className="eyebrow">BYGA / LIVE OFFICE</span>
                <h2 id="office-status-title">Status kantor</h2>
              </div>
              <button
                type="button"
                aria-label="Tutup status kantor"
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </div>
            <p className="office-status-summary">
              <span className="dot" />
              {!online ? "Koneksi terputus" : office.replaceAll("_", " ")}
            </p>
            {!online && (
              <p>Kantor akan memperbarui data saat koneksi kembali tersedia.</p>
            )}
            <Notice error={error} retry={retry} />
            <Notice
              error={
                marketUnavailable
                  ? "Data pasar belum tersedia. Status kantor belum dapat dipastikan."
                  : undefined
              }
              retry={retry}
            />
            {development && (
              <p className="notice">
                Lingkungan pengembangan lokal · candle fixture bukan data pasar
                produksi.
              </p>
            )}
            <MeetingStatus presentation={presentation} />
            {presentation.current && (
              <button
                type="button"
                className="button"
                onClick={() => {
                  setOpen(false);
                  presentation.openDetails(presentation.current);
                }}
              >
                Baca percakapan {roles[presentation.current.character]}
              </button>
            )}
            {!presentation.active && !presentation.error && (
              <p>
                Belum ada meeting aktif. Tim memantau market dari meja kerja.
              </p>
            )}
          </div>
        </InfoDialog>
      )}
    </div>
  );
}
