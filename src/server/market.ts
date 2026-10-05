import { z } from "zod";
import {
  candleSchema,
  CHART_DB_MARKET,
  MARKET,
  timeframes,
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
  tickSize: z.number().positive().optional(),
});
const duration: Record<Timeframe, number> = {
  H1: 3600000,
  M15: 900000,
  M5: 300000,
};
/** CHART_DB deliberately has no write path. SQL identifiers are allowlisted; values bound. */
export async function readMarket(
  env: Pick<Env, "CHART_DB" | "CHART_SCHEMA">,
  at = Date.now(),
  count = 260,
  delay = 5000,
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
        at - (candles.at(-1)!.timestamp + duration[tf]) >
        duration[tf] + delay
      )
        throw new Error(`Stale ${tf} data`);
      return [tf, candles] as const;
    }),
  );
  return Object.fromEntries(entries) as MarketContext;
}
