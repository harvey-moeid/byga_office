import { describe, expect, it, vi } from "vitest";
import { chartQuery, readChart } from "../src/server/chart";
import { chartResponseSchema } from "../src/core/chart";
import { mergeChartCandles } from "../src/ui/chart-data";
import type { Candle } from "../src/core/contracts";

const now = Date.parse("2026-10-11T12:00:10Z");
const candle = (timestamp: number): Candle => ({
  timestamp,
  open: 100,
  high: 102,
  low: 99,
  close: 101,
  volume: 30,
});
const schema = {
  table: "candles",
  market: "symbol",
  timeframe: "timeframe",
  timestamp: "ts",
  open: "open",
  high: "high",
  low: "low",
  close: "close",
  volume: "volume",
  closed: "is_closed",
  timestampUnit: "seconds",
  timeframeValues: { M5: "5", M15: "15", H1: "60" },
};

function fixture(timestamps: number[], unit = "seconds", invalid = false) {
  const prepare = vi.fn((sql: string) => ({
    bind: (...values: (number | string)[]) => {
      expect(sql).toMatch(/^SELECT /);
      expect(sql).not.toMatch(/\b(UPDATE|DELETE|INSERT|ALTER|DROP|CREATE)\b/);
      expect(sql).toContain('AND "is_closed" = 1');
      expect(values.slice(0, 2)).toEqual(["BTCUSDT", "5"]);
      return {
        all: async () => ({
          results: timestamps.map((timestamp) => ({
            ...candle(timestamp),
            volume: invalid ? null : 30,
          })),
        }),
        first: async () =>
          timestamps.length ? { timestamp: Math.max(...timestamps) } : null,
      };
    },
  }));
  return {
    CHART_DB: { prepare } as unknown as D1Database,
    CHART_SCHEMA: JSON.stringify({ ...schema, timestampUnit: unit }),
    APP_ENV: "production",
  };
}

describe("Display-only chart history", () => {
  it("defaults to a bounded M5 snapshot and validates query parameters", () => {
    expect(chartQuery(new URLSearchParams(), now)).toEqual({
      timeframe: "M5",
      limit: 500,
    });
    expect(
      chartQuery(new URLSearchParams("timeframe=H1&limit=1000&after=0"), now),
    ).toEqual({ timeframe: "H1", limit: 1000, after: 0 });
    for (const query of [
      "timeframe=D1",
      "limit=1001",
      "limit=9",
      "limit=NaN",
      "limit=1e2",
      "after=-1",
      "after=0.5",
      "after=Infinity",
      `after=${now + 1}`,
      "market=ETHUSDT",
      "limit=10&limit=20",
      "after=",
    ])
      expect(() => chartQuery(new URLSearchParams(query), now)).toThrow();
  });
  it.each(["seconds", "milliseconds"])(
    "normalizes %s, reads only closed rows and accepts short histories",
    async (unit) => {
      const multiplier = unit === "seconds" ? 1000 : 1;
      const latest = Date.parse("2026-10-11T11:55:00Z");
      const env = fixture(
        [latest / multiplier, (latest - 300000) / multiplier],
        unit,
      );
      const result = await readChart(
        env,
        chartQuery(new URLSearchParams(), now),
        now,
        5000,
      );
      expect(result.status).toBe("OK");
      expect(result.candles.map((c) => c.timestamp)).toEqual([
        latest - 300000,
        latest,
      ]);
      expect(result.latest_timestamp).toBe(latest);
      expect(result.has_more).toBe(false);
      expect(result.development).toBe(false);
      expect(chartResponseSchema.safeParse(result).success).toBe(true);
      expect(env.CHART_DB.prepare).toHaveBeenCalledTimes(1);
    },
  );
  it("labels stale and empty histories without relaxing the trading reader", async () => {
    const stale = await readChart(
      fixture([now / 1000 - 1000]),
      chartQuery(new URLSearchParams(), now),
      now,
      5000,
    );
    expect(stale.status).toBe("STALE");
    const empty = await readChart(
      fixture([]),
      chartQuery(new URLSearchParams(), now),
      now,
      5000,
    );
    expect(empty.status).toBe("EMPTY");
    expect(empty.latest_timestamp).toBeNull();
    expect(empty.candles).toEqual([]);
  });
  it("uses an exclusive cursor, ascending batches and metadata even for an unchanged poll", async () => {
    const latest = Date.parse("2026-10-11T11:55:00Z");
    const env = fixture([latest / 1000]);
    const result = await readChart(
      env,
      chartQuery(new URLSearchParams(`after=${latest - 300000}`), now),
      now,
      5000,
    );
    expect(result.candles).toHaveLength(1);
    expect(env.CHART_DB.prepare).toHaveBeenCalledTimes(2);
    expect(
      (env.CHART_DB.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toContain('AND "ts" > ? ORDER BY "ts" ASC');
    const unchanged = await readChart(
      fixture([]),
      chartQuery(new URLSearchParams(`after=${latest}`), now),
      now,
      5000,
    );
    expect(unchanged.candles).toEqual([]);
  });
  it("reports truncated catch-up and gaps, rejects invalid OHLC, duplicate times and SQL identifiers", async () => {
    const latest = Date.parse("2026-10-11T11:55:00Z") / 1000;
    const times = Array.from({ length: 11 }, (_, i) => latest - (10 - i) * 300);
    const result = await readChart(
      fixture(times),
      chartQuery(new URLSearchParams("after=0&limit=10"), now),
      now,
      5000,
    );
    expect(result.candles).toHaveLength(10);
    expect(result.has_more).toBe(true);
    expect(result.latest_timestamp).toBe(latest * 1000);
    const gap = await readChart(
      fixture([latest, latest - 600]),
      chartQuery(new URLSearchParams(), now),
      now,
      5000,
    );
    expect(gap.gap_count).toBe(1);
    await expect(
      readChart(
        fixture([latest, latest]),
        chartQuery(new URLSearchParams(), now),
        now,
        5000,
      ),
    ).rejects.toThrow("Duplicate");
    await expect(
      readChart(
        fixture([latest], "seconds", true),
        chartQuery(new URLSearchParams(), now),
        now,
        5000,
      ),
    ).rejects.toThrow();
    const injected = fixture([]);
    injected.CHART_SCHEMA = JSON.stringify({
      ...schema,
      table: 'candles"; DELETE FROM candles',
    });
    await expect(
      readChart(injected, chartQuery(new URLSearchParams(), now), now, 5000),
    ).rejects.toThrow();
    expect(injected.CHART_DB.prepare).not.toHaveBeenCalled();
  });
  it("merges overlapping updates in order and keeps at most 1000 candles", () => {
    const history = Array.from({ length: 1000 }, (_, i) => candle(i * 300000));
    expect(mergeChartCandles(history, [])).toBe(history);
    const result = mergeChartCandles(history, [
      candle(1001 * 300000),
      { ...history[999], close: 102 },
      candle(1000 * 300000),
    ]);
    expect(result).toHaveLength(1000);
    expect(result[0].timestamp).toBe(2 * 300000);
    expect(result.at(-1)?.timestamp).toBe(1001 * 300000);
    expect(result.at(-3)?.close).toBe(102);
  });
});
