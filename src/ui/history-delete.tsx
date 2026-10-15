import { useState } from "react";
import { api, useAction } from "./data";
import { useSession } from "./session";
import { Notice } from "./shared";

export function HistoryDelete({
  mode,
  caseId,
  onDeleted,
}: {
  mode: "LIVE" | "SIMULATION";
  caseId?: string;
  onDeleted: () => void;
}) {
  const session = useSession();
  const action = useAction();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  if (!session.data?.admin) return null;
  return (
    <div className="history-delete">
      <button
        disabled={action.busy}
        onClick={() => {
          const before = Date.now();
          if (
            !window.confirm(
              `Hapus ${caseId ?? (mode === "LIVE" ? "seluruh histori case dan sinyal live yang selesai" : "seluruh histori simulasi yang selesai")}? Histori akan hilang dari tampilan dan tautan detail. Catatan operasional tetap disimpan untuk audit, batas penggunaan, dan pencegahan transaksi ganda.`,
            )
          )
            return;
          void action.run(async () => {
            setError("");
            setMessage("");
            try {
              const result = await api<{ deleted: number }>(
                "/admin/history/delete",
                { mode, caseId, before, confirmed: true },
              );
              setMessage(
                `${result.deleted} histori dihapus. Case aktif tetap tersedia.`,
              );
              onDeleted();
            } catch (error) {
              setError((error as Error).message);
            }
          });
        }}
      >
        {action.busy
          ? "Menghapus…"
          : caseId
            ? "Hapus histori case"
            : "Hapus histori selesai"}
      </button>
      <Notice error={error} />
      {message && <p role="status">{message}</p>}
    </div>
  );
}
