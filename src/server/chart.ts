import { z } from "zod";
import {
  CHART_DB_MARKET,
  MARKET,
  candleSchema,
  timeframes,
} from "../core/contracts";
import {
  candleDuration,
  chartHistoryLimit,
  type ChartResponse,
} from "../core/chart";
import type { Env } from "./env";
import { HttpError } from "./http";
import { chartSchema } from "./market";

export function chartQuery(params: URLSearchParams, now: number) {
  const allowed = ["timeframe", "limit", "after"];
  if (
    Array.from(params.keys()).some(
      (key) => !allowed.includes(key) || params.getAll(key).length !== 1,
    )
  )
    throw new HttpError(400, "Invalid chart query", "INVALID_CHART_QUERY");
  const integer = (key: string, fallback?: number) => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)))
      throw new HttpError(400, "Invalid chart query", "INVALID_CHART_QUERY");
    return Number(raw);
  };
  const parsed = z
    .object({
      timeframe: z.enum(timeframes),
      limit: z.number().int().min(10).max(chartHistoryLimit),
      after: z.number().int().nonnegative().max(now).optional(),
    })
    .safeParse({
      timeframe: params.get("timeframe") ?? "M5",
      limit: integer("limit", 500),
      after: integer("after"),
    });
  if (!parsed.success)
    throw new HttpError(
      400,
      "Use M5, M15 or H1; limit 10–1000; after is a UTC millisecond timestamp",
      "INVALID_CHART_QUERY",
    );
  return parsed.data;
}

/** Display-only reads. Partial/stale history is labelled, never admitted to trading. */
export async function readChart(
  env: Pick<Env, "CHART_DB" | "CHART_SCHEMA" | "APP_ENV">,
  query: ReturnType<typeof chartQuery>,
  now: number,
  delay: number,
): Promise<ChartResponse> {
  const s = chartSchema.parse(JSON.parse(env.CHART_SCHEMA));
  const multiplier = s.timestampUnit === "seconds" ? 1000 : 1;
  const duration = candleDuration[query.timeframe];
  const cutoff = Math.floor((now - duration - delay) / multiplier);
  const where = `"${s.market}" = ? AND "${s.timeframe}" = ? AND "${s.timestamp}" <= ?${s.closed ? ` AND "${s.closed}" = 1` : ""}`;
  const values = [
    CHART_DB_MARKET,
    s.timeframeValues?.[query.timeframe] ?? query.timeframe,
    cutoff,
  ];
  const incremental = query.after !== undefined;
  const result = await env.CHART_DB.prepare(
    `SELECT "${s.timestamp}" AS timestamp, "${s.open}" AS open, "${s.high}" AS high, "${s.low}" AS low, "${s.close}" AS close, "${s.volume}" AS volume FROM "${s.table}" WHERE ${where}${incremental ? ` AND "${s.timestamp}" > ?` : ""} ORDER BY "${s.timestamp}" ${incremental ? "ASC" : "DESC"} LIMIT ?`,
  )
    .bind(
      ...values,
      ...(incremental ? [query.after! / multiplier] : []),
      query.limit + (incremental ? 1 : 0),
    )
    .all<Record<string, unknown>>();
  const hasMore = incremental && result.results.length > query.limit;
  const rows = result.results.slice(0, query.limit);
  if (!incremental) rows.reverse();
  const candles = rows.map((row) =>
    candleSchema.parse(
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          (value === null || value === undefined ? NaN : Number(value)) *
            (key === "timestamp" ? multiplier : 1),
        ]),
      ),
    ),
  );
  let gapCount = 0;
  for (let i = 1; i < candles.length; i++) {
    const difference = candles[i].timestamp - candles[i - 1].timestamp;
    if (difference <= 0)
      throw new Error("Duplicate or unordered chart candles");
    if (difference !== duration) gapCount++;
  }
  const latestRow = incremental
    ? await env.CHART_DB.prepare(
        `SELECT "${s.timestamp}" AS timestamp FROM "${s.table}" WHERE ${where} ORDER BY "${s.timestamp}" DESC LIMIT 1`,
      )
        .bind(...values)
        .first<{ timestamp: number }>()
    : null;
  const latest = incremental
    ? latestRow
      ? Number(latestRow.timestamp) * multiplier
      : null
    : (candles.at(-1)?.timestamp ?? null);
  if (latest !== null && (!Number.isSafeInteger(latest) || latest < 0))
    throw new Error("Invalid latest chart timestamp");
  return {
    market: MARKET,
    timeframe: query.timeframe,
    candles,
    latest_timestamp: latest,
    observed_at: now,
    status:
      latest === null
        ? "EMPTY"
        : now - (latest + duration) > duration + delay
          ? "STALE"
          : "OK",
    has_more: hasMore,
    gap_count: gapCount,
    tickSize: s.tickSize ?? 0.01,
    development: env.APP_ENV !== "production" && env.APP_ENV !== "staging",
  };
}
