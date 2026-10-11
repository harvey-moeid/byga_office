import { useCallback, useEffect, useRef, useState } from "react";
import {
  chartHistoryLimit,
  chartPollMs,
  chartResponseSchema,
  type ChartResponse,
} from "../core/chart";
import type { Candle, Timeframe } from "../core/contracts";
import { api } from "./data";

export function mergeChartCandles(history: Candle[], incoming: Candle[]) {
  if (!incoming.length) return history;
  const byTime = new Map(history.map((candle) => [candle.timestamp, candle]));
  for (const candle of incoming) byTime.set(candle.timestamp, candle);
  return Array.from(byTime.values())
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-chartHistoryLimit);
}

export function useChartData(timeframe: Timeframe) {
  const [state, setState] = useState<{
    data?: ChartResponse;
    loading: boolean;
    error?: string;
  }>({ loading: true });
  const reload = useRef<() => void>(() => {});
  useEffect(() => {
    let live = true;
    let history: Candle[] = [];
    let initialized = false;
    let active: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState({ loading: true });
    const load = async () => {
      clearTimeout(timer);
      timer = undefined;
      if (!live || active || document.hidden || !navigator.onLine) return;
      const controller = new AbortController();
      active = controller;
      try {
        const cursor = initialized ? history.at(-1)?.timestamp : undefined;
        const query = new URLSearchParams({ timeframe, limit: "500" });
        if (cursor !== undefined) query.set("after", String(cursor));
        const data = chartResponseSchema.parse(
          await api<unknown>(
            `/market/candles?${query}`,
            undefined,
            controller.signal,
          ),
        );
        if (!live || controller.signal.aborted) return;
        if (data.timeframe !== timeframe)
          throw new Error("Timeframe respons chart tidak sesuai.");
        // Catch up after a long absence with one bounded snapshot instead of many requests.
        if (
          cursor !== undefined &&
          (data.has_more ||
            data.latest_timestamp === null ||
            data.latest_timestamp < cursor)
        ) {
          initialized = false;
          timer = setTimeout(load, 100);
          return;
        }
        history =
          cursor === undefined
            ? data.candles
            : mergeChartCandles(history, data.candles);
        initialized = true;
        setState({ data: { ...data, candles: history }, loading: false });
      } catch (error) {
        if (live && !controller.signal.aborted)
          setState((previous) => ({
            ...previous,
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : "Tidak dapat memuat chart.",
          }));
      } finally {
        if (active === controller) active = undefined;
        if (
          live &&
          !controller.signal.aborted &&
          !timer &&
          navigator.onLine &&
          !document.hidden
        )
          timer = setTimeout(load, chartPollMs);
      }
    };
    const refresh = () => {
      clearTimeout(timer);
      timer = undefined;
      void load();
    };
    const pause = () => {
      clearTimeout(timer);
      timer = undefined;
      active?.abort();
      active = undefined;
    };
    const offline = () => {
      pause();
      setState((previous) => ({
        ...previous,
        loading: false,
        error:
          "Koneksi terputus. Chart akan diperbarui saat tersambung kembali.",
      }));
    };
    const visible = () => (document.hidden ? pause() : refresh());
    reload.current = refresh;
    if (!navigator.onLine) offline();
    else void load();
    window.addEventListener("online", refresh);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visible);
    return () => {
      live = false;
      pause();
      reload.current = () => {};
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [timeframe]);
  return { ...state, retry: useCallback(() => reload.current(), []) };
}
