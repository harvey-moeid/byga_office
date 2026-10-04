import { useEffect, useState } from "react";

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
    const data = (await res.json()) as T & { error?: unknown };
    if (!res.ok)
      throw new Error(
        typeof data.error === "string" ? data.error : "Permintaan tidak valid",
      );
    return data;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (!navigator.onLine)
      throw new Error(
        "Koneksi terputus. Data akan diperbarui setelah tersambung kembali.",
      );
    if (controller.signal.aborted)
      throw new Error("Server belum merespons. Coba lagi.");
    if (error instanceof TypeError || error instanceof SyntaxError)
      throw new Error("Tidak dapat memuat data dari server. Coba lagi.");
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

export function useData<T>(path: string, poll = false) {
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
            ...s,
            loading: false,
            error: `${s.data ? "Data terakhir belum diperbarui. " : ""}${(error as Error).message}`,
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
          timer = setTimeout(load, 5000);
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
    void load();
    window.addEventListener("online", load);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visible);
    return () => {
      live = false;
      clearTimeout(timer);
      active?.abort();
      window.removeEventListener("online", load);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [path, poll, version]);
  const visible: typeof state =
    state.path === path ? state : { path, loading: true };
  return { ...visible, retry: () => refresh((v) => v + 1) };
}

/** SSE is an acceleration layer only; the regular request remains the fallback. */
export function useOfficeState<T>() {
  const fallback = useData<T>("/office/state", true);
  const [live, setLive] = useState<{ data: T; updatedAt: number }>();
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
          source?.close();
        }
      });
    };
    const offline = () => {
      source?.close();
      source = undefined;
      setLive(undefined);
    };
    const visible = () => (document.hidden ? offline() : connect());
    connect();
    window.addEventListener("online", connect);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visible);
    return () => {
      source?.close();
      window.removeEventListener("online", connect);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return live
    ? { ...fallback, data: live.data, updatedAt: live.updatedAt, error: undefined }
    : fallback;
}
