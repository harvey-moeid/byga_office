import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiErrorBody } from "../core/api";

export const authExpiredEvent = "byga:auth-expired";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
  get ambiguous() {
    return this.status === 0 || this.status >= 500 || this.status === 408;
  }
}

export async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(cancel, 15000);
  try {
    const res = await fetch(`/api/v1${path}`, {
      method: body !== undefined ? "POST" : "GET",
      credentials: "same-origin",
      headers:
        body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (
      res.status === 401 &&
      path !== "/auth/login" &&
      typeof window !== "undefined"
    )
      window.dispatchEvent(new Event(authExpiredEvent));
    let data: T & ApiErrorBody;
    try {
      data = (await res.json()) as T & ApiErrorBody;
    } catch {
      if (!res.ok)
        throw new ApiError(
          "Tidak dapat memuat data dari server. Coba lagi.",
          res.status,
        );
      throw new ApiError(
        "Respons server tidak sesuai format.",
        502,
        "INVALID_RESPONSE",
      );
    }
    if (data === null || typeof data !== "object")
      throw new ApiError(
        "Respons server tidak sesuai format.",
        res.ok ? 502 : res.status,
        "INVALID_RESPONSE",
      );
    if (!res.ok) {
      const issues = [
        ...(data.details?.formErrors ?? []),
        ...Object.values(data.details?.fieldErrors ?? {}).flat(),
      ];
      throw new ApiError(
        issues.length
          ? issues.join(" · ")
          : typeof data.error === "string"
            ? data.error
            : "Permintaan tidak valid",
        res.status,
        data.code,
      );
    }
    return data;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof ApiError) throw error;
    if (!navigator.onLine)
      throw new ApiError(
        "Koneksi terputus. Data akan diperbarui setelah tersambung kembali.",
        0,
      );
    if (controller.signal.aborted)
      throw new ApiError(
        "Server belum merespons. Hasil permintaan belum diketahui.",
        0,
        "TIMEOUT",
      );
    if (error instanceof TypeError || error instanceof SyntaxError)
      throw new ApiError(
        "Tidak dapat memuat data dari server. Coba lagi.",
        0,
        "NETWORK_ERROR",
      );
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export function useData<T>(path: string, poll: boolean | number = false) {
  const [state, set] = useState<{
    path: string;
    data?: T;
    error?: string;
    loading: boolean;
    updatedAt?: number;
  }>({ path, loading: true });
  const [version, refresh] = useState(0);
  useEffect(() => {
    let live = true;
    let active: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    set((s) => (s.path === path ? s : { path, loading: true }));
    const load = async () => {
      clearTimeout(timer);
      if (!live || active) return;
      if (!navigator.onLine) {
        set((s) => ({
          ...s,
          loading: false,
          error: "Koneksi terputus. Menunggu jaringan…",
        }));
        return;
      }
      if (document.hidden && poll) return;
      const request = new AbortController();
      active = request;
      try {
        const data = await api<T>(path, undefined, request.signal);
        if (live && !request.signal.aborted)
          set({ path, data, loading: false, updatedAt: Date.now() });
      } catch (error) {
        if (live && !request.signal.aborted)
          set((s) => ({
            ...(error instanceof ApiError && error.status === 401
              ? { path }
              : s),
            loading: false,
            error: `${s.data && !(error instanceof ApiError && error.status === 401) ? "Data terakhir belum diperbarui. " : ""}${(error as Error).message}`,
          }));
      } finally {
        if (active === request) active = undefined;
        if (
          live &&
          !request.signal.aborted &&
          poll &&
          navigator.onLine &&
          !document.hidden
        )
          timer = setTimeout(load, typeof poll === "number" ? poll : 5000);
      }
    };
    const offline = () => {
      clearTimeout(timer);
      active?.abort();
      active = undefined;
      set((s) => ({
        ...s,
        loading: false,
        error: "Koneksi terputus. Data yang tampil belum diperbarui.",
      }));
    };
    const visible = () => {
      if (!document.hidden) void load();
      else clearTimeout(timer);
    };
    const expired = () => {
      if (!(
        path.startsWith("/admin/") ||
        path.startsWith("/signals") ||
        path.startsWith("/cases/") ||
        path.startsWith("/characters/") ||
        path === "/office/meeting"
      ))
        return;
      clearTimeout(timer);
      active?.abort();
      active = undefined;
      set({
        path,
        loading: false,
        error: "Sesi Admin berakhir. Login kembali.",
      });
      // Public summaries must be fetched again without retaining Admin payloads.
      if (!path.startsWith("/admin/") && !path.startsWith("/signals"))
        void load();
    };
    void load();
    window.addEventListener("online", load);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener(authExpiredEvent, expired);
    return () => {
      live = false;
      clearTimeout(timer);
      active?.abort();
      window.removeEventListener("online", load);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener(authExpiredEvent, expired);
    };
  }, [path, poll, version]);
  const visible: typeof state =
    state.path === path ? state : { path, loading: true };
  const retry = useCallback(() => refresh((v) => v + 1), []);
  return { ...visible, retry };
}

/** SSE is an acceleration layer only; the regular request remains the fallback. */
export function useOfficeState<T>() {
  const fallback = useData<T>("/office/state", true);
  const [live, setLive] = useState<{ data: T; updatedAt: number }>();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let source: EventSource | undefined;
    const connect = () => {
      source?.close();
      if (!navigator.onLine || document.hidden) return;
      source = new EventSource("/api/v1/office/events");
      source.addEventListener("office", (event) => {
        try {
          setLive({
            data: JSON.parse((event as MessageEvent<string>).data) as T,
            updatedAt: Date.now(),
          });
        } catch {
          setLive(undefined);
          source?.close();
        }
      });
      const unavailable = () => setLive(undefined);
      source.addEventListener("error", unavailable);
      source.addEventListener("unavailable", unavailable);
    };
    const offline = () => {
      source?.close();
      source = undefined;
      setLive(undefined);
    };
    const visible = () => (document.hidden ? offline() : connect());
    connect();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    window.addEventListener("online", connect);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visible);
    return () => {
      source?.close();
      clearInterval(timer);
      window.removeEventListener("online", connect);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  const timestamp = (data: T | undefined, received = 0) => {
    const observed = (data as { observed_at?: number } | undefined)
      ?.observed_at;
    return typeof observed === "number" && Number.isFinite(observed)
      ? observed
      : received;
  };
  const freshLive =
    live &&
    now - live.updatedAt < 15000 &&
    timestamp(live.data, live.updatedAt) >
      timestamp(fallback.data, fallback.updatedAt);
  return freshLive
    ? {
        ...fallback,
        loading: false,
        data: live.data,
        updatedAt: live.updatedAt,
        error: undefined,
      }
    : fallback;
}

export function useAction() {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T>(action: () => Promise<T>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      return await action();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, run };
}

interface Intent {
  key: string;
  payload: Record<string, unknown>;
}
/** One stable request identity survives transport failure and a tab reload. */
export function useOperationIntent(
  kind: "config" | "emergency" | "simulation",
) {
  const storageKey = `byga:intent:${kind}`;
  const [pending, setPending] = useState<Intent | undefined>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      const value = raw ? (JSON.parse(raw) as Intent) : undefined;
      return value &&
        typeof value.key === "string" &&
        value.payload &&
        typeof value.payload === "object"
        ? value
        : undefined;
    } catch {
      return undefined;
    }
  });
  const intent = useRef(pending),
    running = useRef(false);
  const [busy, setBusy] = useState(false);
  const remember = (value?: Intent) => {
    intent.current = value;
    setPending(value);
    try {
      if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* In-memory retry is still safe when storage is unavailable. */
    }
  };
  const send = async <T>(
    path: string,
    payload: Record<string, unknown>,
  ): Promise<T> => {
    if (running.current) throw new Error("Permintaan masih diproses.");
    if (
      intent.current &&
      JSON.stringify(intent.current.payload) !== JSON.stringify(payload)
    )
      throw new Error(
        "Hasil permintaan sebelumnya belum pasti. Ulangi permintaan tersimpan sebelum mengubah input.",
      );
    // A rejection of this retry cannot establish whether an earlier attempt
    // committed. Keep its identity until a success reconciles the outcome or
    // the user explicitly starts a new operation.
    const reconciling = intent.current !== undefined;
    const operation = intent.current ?? { key: crypto.randomUUID(), payload };
    running.current = true;
    setBusy(true);
    remember(operation);
    try {
      const result = await api<T>(path, {
        ...operation.payload,
        idempotencyKey: operation.key,
      });
      remember(undefined);
      return result;
    } catch (error) {
      if (error instanceof ApiError && !error.ambiguous && !reconciling)
        remember(undefined);
      throw error;
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const retry = <T>(path: string) => {
    if (!intent.current)
      return Promise.reject<T>(new Error("Tidak ada permintaan tersimpan."));
    return send<T>(path, intent.current.payload);
  };
  const startNew = () => {
    if (running.current) return false;
    if (
      !window.confirm(
        "Permintaan sebelumnya mungkin sudah diterima server. Membuat permintaan baru dapat menggandakan pekerjaan. Lanjut membuat permintaan baru?",
      )
    )
      return false;
    remember(undefined);
    return true;
  };
  return { busy, pending, send, retry, startNew };
}
