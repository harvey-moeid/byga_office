import { describe, expect, it, vi } from "vitest";
import { readMarket } from "../src/server/market";
const now = Date.parse("2026-10-03T12:00:10Z");
const schema = {
  table: "candles",
  market: "symbol",
  timeframe: "timeframe",
  timestamp: "timestamp",
  open: "open",
  high: "high",
  low: "low",
  close: "close",
  volume: "volume",
  timestampUnit: "seconds",
};
function env(gap = false) {
  const prepare = vi.fn((sql: string) => {
    expect(sql).toMatch(/^SELECT /);
    expect(sql).not.toMatch(/\b(INSERT|DELETE|UPDATE|REPLACE)\b/);
    return {
      bind: (_market: string, tf: string, cutoff: number, count: number) => ({
        all: async () => {
          const duration = { H1: 3600, M15: 900, M5: 300 }[
            tf as "H1" | "M15" | "M5"
          ];
          const latest = Math.floor(cutoff / duration) * duration;
          return {
            results: Array.from({ length: count }, (_, i) => ({
              timestamp:
                latest - i * duration - (gap && i === 3 ? duration : 0),
              open: 100,
              high: 102,
              low: 99,
              close: 101,
              volume: 30,
            })),
          };
        },
      }),
    };
  });
  return {
    CHART_DB: { prepare } as unknown as D1Database,
    CHART_SCHEMA: JSON.stringify(schema),
  };
}
describe("Read-only chart repository", () => {
  it("normalizes seconds to UTC milliseconds, reads three closed timeframes with no writes", async () => {
    const e = env(),
      r = await readMarket(e, now);
    expect(e.CHART_DB.prepare).toHaveBeenCalledTimes(3);
    expect(r.M5.at(-1)!.timestamp).toBe(Date.parse("2026-10-03T11:55:00Z"));
    expect(r.H1).toHaveLength(260);
  });
  it("rejects missing and duplicate candles", async () => {
    await expect(readMarket(env(true), now)).rejects.toThrow(
      "Missing or duplicate",
    );
  });
  it("rejects SQL identifier injection before making any query", async () => {
    const e = env();
    e.CHART_SCHEMA = JSON.stringify({
      ...schema,
      table: "candles; DELETE FROM candles",
    });
    await expect(readMarket(e, now)).rejects.toThrow();
    expect(e.CHART_DB.prepare).not.toHaveBeenCalled();
  });
  it("includes an explicit closed flag only when configured", async () => {
    const e = env();
    e.CHART_SCHEMA = JSON.stringify({ ...schema, closed: "is_closed" });
    await readMarket(e, now);
    for (const [sql] of (e.CHART_DB.prepare as ReturnType<typeof vi.fn>).mock
      .calls)
      expect(sql).toContain('AND "is_closed" = 1');
  });
  it("rejects injection in the closed flag before querying", async () => {
    const e = env();
    e.CHART_SCHEMA = JSON.stringify({ ...schema, closed: "is_closed OR 1=1" });
    await expect(readMarket(e, now)).rejects.toThrow();
    expect(e.CHART_DB.prepare).not.toHaveBeenCalled();
  });
});
