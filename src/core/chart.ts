import { z } from "zod";
import { candleSchema, MARKET, timeframes } from "./contracts";

export const chartHistoryLimit = 1000;
export const chartPollMs = 30000;
export const candleDuration = { M5: 300000, M15: 900000, H1: 3600000 } as const;
export const chartResponseSchema = z
  .object({
    market: z.literal(MARKET),
    timeframe: z.enum(timeframes),
    candles: z.array(candleSchema).max(chartHistoryLimit),
    latest_timestamp: z.number().int().nonnegative().nullable(),
    observed_at: z.number().int().nonnegative(),
    status: z.enum(["OK", "STALE", "EMPTY"]),
    has_more: z.boolean(),
    gap_count: z.number().int().nonnegative(),
    tickSize: z.number().finite().positive(),
    development: z.boolean(),
  })
  .superRefine((value, context) => {
    for (let i = 1; i < value.candles.length; i++) {
      if (value.candles[i].timestamp <= value.candles[i - 1].timestamp)
        context.addIssue({
          code: "custom",
          message: "Candles must be ordered and unique",
        });
    }
  });
export type ChartResponse = z.infer<typeof chartResponseSchema>;
