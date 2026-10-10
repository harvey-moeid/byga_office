import { z } from "zod";
import {
  candleSchema,
  CHART_DB_MARKET,
  timeframes,
  type DerivativeMetricPoint,
  type DerivativesContext,
  type MarketContext,
  type Timeframe,
} from "../core/contracts";
import type { Env } from "./env";
const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
export const chartSchema = z.object({
  table: identifier,
  market: identifier,
  timeframe: identifier,
  timestamp: identifier,
  open: identifier,
  high: identifier,
  low: identifier,
  close: identifier,
  volume: identifier,
  closed: identifier.optional(),
  timestampUnit: z.enum(["seconds", "milliseconds"]),
  timeframeValues: z
    .object({ H1: z.string(), M15: z.string(), M5: z.string() })
    .optional(),
  tickSize: z.number().finite().positive().optional(),
});
const duration: Record<Timeframe, number> = {
  H1: 3600000,
  M15: 900000,
  M5: 300000,
};
export type MarketReadOptions = {
  /** Runtime defaults to strict. Deploy health checks may inspect stale rows without consuming them for trading. */
  enforceFreshness?: boolean;
};
/** CHART_DB deliberately has no write path. SQL identifiers are allowlisted; values bound. */
export async function readMarket(
  env: Pick<Env, "CHART_DB" | "CHART_SCHEMA">,
  at = Date.now(),
  count = 260,
  delay = 5000,
  options: MarketReadOptions = {},
): Promise<MarketContext> {
  const s = chartSchema.parse(JSON.parse(env.CHART_SCHEMA));
  const multiplier = s.timestampUnit === "seconds" ? 1000 : 1;
  const entries = await Promise.all(
    timeframes.map(async (tf) => {
      const cutoff = Math.floor((at - duration[tf] - delay) / multiplier);
      const closed = s.closed ? ` AND "${s.closed}" = 1` : "";
      const sql = `SELECT "${s.timestamp}" AS timestamp, "${s.open}" AS open, "${s.high}" AS high, "${s.low}" AS low, "${s.close}" AS close, "${s.volume}" AS volume FROM "${s.table}" WHERE "${s.market}" = ? AND "${s.timeframe}" = ? AND "${s.timestamp}" <= ?${closed} ORDER BY "${s.timestamp}" DESC LIMIT ?`;
      const rows = await env.CHART_DB.prepare(sql)
        .bind(CHART_DB_MARKET, s.timeframeValues?.[tf] ?? tf, cutoff, count)
        .all<Record<string, unknown>>();
      const candles = rows.results
        .reverse()
        .map((r) =>
          candleSchema.parse(
            Object.fromEntries(
              Object.entries(r).map(([k, v]) => [
                k,
                Number(v) * (k === "timestamp" ? multiplier : 1),
              ]),
            ),
          ),
        );
      if (candles.length < count)
        throw new Error(
          `Insufficient ${tf} candles: need ${count}, got ${candles.length}`,
        );
      for (let i = 1; i < candles.length; i++)
        if (candles[i].timestamp - candles[i - 1].timestamp !== duration[tf])
          throw new Error(`Missing or duplicate ${tf} candle`);
      if (
        options.enforceFreshness !== false &&
        at - (candles.at(-1)!.timestamp + duration[tf]) >
          duration[tf] + delay
      )
        throw new Error(`Stale ${tf} data`);
      return [tf, candles] as const;
    }),
  );
  return Object.fromEntries(entries) as MarketContext;
}


const derivativeMetrics = [
  ["open_interest", "M5"],
  ["funding_rate", ""],
  ["liquidation", "M5"],
  ["long_short_ratio", "M5"],
] as const;

/** Derivative metrics are optional enrichment from the same read-only chart DB. */
export async function readDerivatives(
  env: Pick<Env, "CHART_DB">,
  at = Date.now(),
  limit = 24,
  delay = 5000,
): Promise<DerivativesContext> {
  const m5Cutoff = Math.floor((at - 300000 - delay) / 300000) * 300000;
  const result = Object.fromEntries(
    await Promise.all(
      derivativeMetrics.map(async ([metric, timeframe]) => {
        try {
          const cutoff = timeframe === "M5" ? m5Cutoff : at - delay;
          const rows = await env.CHART_DB.prepare(
            "SELECT ts,value,value2,value3,source FROM derivative_metrics WHERE symbol=? AND metric=? AND timeframe=? AND ts<=? ORDER BY ts DESC LIMIT ?",
          )
            .bind(CHART_DB_MARKET, metric, timeframe, cutoff, limit)
            .all<Record<string, unknown>>();
          const points = rows.results
            .map((row): DerivativeMetricPoint => ({
              timestamp: Number(row.ts),
              value: Number(row.value),
              value2: row.value2 == null ? null : Number(row.value2),
              value3: row.value3 == null ? null : Number(row.value3),
              source: String(row.source ?? "unknown"),
            }))
            .filter(
              (row) =>
                Number.isSafeInteger(row.timestamp) &&
                Number.isFinite(row.value) &&
                (row.value2 === null || Number.isFinite(row.value2)) &&
                (row.value3 === null || Number.isFinite(row.value3)),
            )
            .reverse();
          return [metric, points] as const;
        } catch {
          // A missing/temporarily unavailable derivative table must not stop
          // candle monitoring. Group 4 will resolve to NONE until data returns.
          return [metric, []] as const;
        }
      }),
    ),
  );
  return result as unknown as DerivativesContext;
}
