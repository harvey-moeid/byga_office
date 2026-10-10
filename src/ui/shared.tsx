import React, { Component, lazy, useEffect, useRef } from "react";
import type { useOperationIntent } from "./data";
export const OfficeScene = lazy(() => import("./scene"));
export const roles: Record<string, string> = {
  trend: "Trend Analyst",
  structure: "Structure Analyst",
  momentum: "Momentum Analyst",
  liquidity: "Liquidity Analyst",
  volume: "Volume Analyst",
  quant: "Quant Analyst",
  derivatives: "Derivatives Analyst",
  positioning: "Market Positioning Analyst",
  risk: "Risk Manager",
  boss: "Head Trader",
};
export function Badge({ value }: { value: string }) {
  return (
    <span
      className={`badge ${value === "BUY" || value === "OK" || value === "CLOSED" ? "positive" : value === "SELL" || value === "DOWN" || value === "FAILED" ? "negative" : ""}`}
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}
export function Notice({
  error,
  retry,
}: {
  error?: string;
  retry?: () => void;
}) {
  return error ? (
    <div role="alert" className="notice">
      {error}
      {retry && <button onClick={retry}>Coba lagi</button>}
    </div>
  ) : null;
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function PendingOperation({
  operation,
  retry,
}: {
  operation: ReturnType<typeof useOperationIntent>;
  retry: () => void;
}) {
  if (!operation.pending || operation.busy) return null;
  return (
    <div className="notice" role="status">
      <span>
        Hasil permintaan sebelumnya belum pasti. Ulangi permintaan yang sama
        untuk memeriksa hasil tanpa membuat pekerjaan ganda.
      </span>
      <button onClick={retry}>Coba ulang permintaan</button>
      <button onClick={operation.startNew}>Buat permintaan baru</button>
    </div>
  );
}
export function InfoDialog({
  children,
  onClose,
  titleId,
}: {
  children: React.ReactNode;
  onClose: () => void;
  titleId: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(
    document.activeElement as HTMLElement | null,
  );
  useEffect(() => {
    opener.current ??= document.activeElement as HTMLElement | null;
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    return () => {
      queueMicrotask(() => opener.current?.focus());
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby={titleId}
      onCancel={onClose}
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const focusable = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const first = focusable[0],
          last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div onClick={(event) => event.stopPropagation()}>{children}</div>
    </dialog>
  );
}
export function Heading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export class SceneBoundary extends Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Empty>3D tidak tersedia. Dashboard operasi tetap dapat digunakan.</Empty>
    ) : (
      this.props.children
    );
  }
}
let webGLSupport: boolean | undefined;
export function supportsWebGL() {
  if (webGLSupport !== undefined) return webGLSupport;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    webGLSupport = !!gl;
    // Dashboard polling must not accumulate probe contexts and evict the
    // actual office renderer from the browser's active-context limit.
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return webGLSupport;
  } catch {
    webGLSupport = false;
    return false;
  }
}
