import { describe, expect, it } from "vitest";
import {
  analysisGroups,
  analysisSchema,
  candleSchema,
  configSchema,
  defaultConfig,
  defaultCharacters,
  formatPrice,
  scannerNames,
  wibDate,
  type AnalystResult,
  type Candle,
  type GroupSnapshot,
  type MarketContext,
  type ScannerOutput,
} from "../src/core/contracts";
import {
  adx,
  atr,
  bollinger,
  ema,
  macd,
  rsi,
  structure,
} from "../src/core/indicators";
import {
  analyzeGroups,
  analystGroup,
  buildContext,
  buildGroupContext,
  confidence,
  groupTrigger,
  risk,
  scan,
  semanticErrors,
  trigger,
  voting,
} from "../src/core/engine";
export function candles(count = 300, trend = 0.02): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + Math.sin(i / 8) * 8 + i * trend;
    return {
      timestamp: i * 300000,
      open: close - 0.3,
      high: close + 1,
      low: close - 1,
      close,
      volume: 100 + (i % 7),
    };
  });
}
const market: MarketContext = { H1: candles(), M15: candles(), M5: candles() };
function scanners(directions: string[]): ScannerOutput[] {
  return scannerNames.map((name, i) => ({
    name,
    direction: directions[i] as ScannerOutput["direction"],
    strength: 100,
    h1_bias: "BUY",
    m15_setup: "BUY",
    m5_trigger: "BUY",
    reasons: ["fixture"],
    levels: [],
    indicators: {},
    timestamp: 1,
    candle_timestamp: 1,
    config_version: "v1",
  }));
}
function groups(directions: string[]): GroupSnapshot[] {
  return analysisGroups.map((group, i) => ({
    group,
    direction: directions[i] as GroupSnapshot["direction"],
    strength: directions[i] === "NONE" ? 0 : 100,
    reasons: ["fixture"],
    payload: {},
    timestamp: 1,
    candle_timestamp: 1,
    config_version: "v1",
  }));
}
function analysts(votes: string[]): AnalystResult[] {
  return votes.map((vote, i) => ({
    id: defaultCharacters()[i].id,
    status: vote === "UNAVAILABLE" ? "UNAVAILABLE" : "SUCCESS",
    output:
      vote === "UNAVAILABLE"
        ? undefined
        : analysisSchema.parse({
            vote,
            confidence: 99,
            summary: "Evidence-led",
            reasoning: "fixture",
            evidence: [],
            risk_flags: [],
          }),
    flags: [],
    validationErrors: [],
    prompt_version: "v1",
  }));
}
describe("Indicators and structure", () => {
  it("EMA uses SMA seed and recurrence", () =>
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([NaN, NaN, 2, 3, 4]));
  it("RSI handles flat, rising and falling without NaN", () => {
    expect(rsi(Array(30).fill(100))).toBe(50);
    expect(rsi(Array.from({ length: 30 }, (_, i) => i + 1))).toBe(100);
    expect(rsi(Array.from({ length: 30 }, (_, i) => 30 - i))).toBe(0);
  });
  it("ATR and ADX match flat OHLC reference", () => {
    const c = candles().map((c) => ({
      ...c,
      open: 100,
      close: 100,
      high: 101,
      low: 99,
    }));
    expect(atr(c)).toBe(2);
    expect(adx(c)).toBe(0);
  });
  it("MACD and Bollinger remain zero/constant on flat series", () => {
    expect(macd(Array(100).fill(10))).toEqual({
      line: 0,
      signal: 0,
      histogram: 0,
    });
    expect(bollinger(Array(30).fill(10))).toEqual({
      mid: 10,
      upper: 10,
      lower: 10,
      deviation: 0,
    });
  });
  it("detects confirmed swings and rejects unconfirmed lookahead endpoints", () => {
    const s = structure(candles());
    expect(s.highs.length).toBeGreaterThan(2);
    expect(s.lows.length).toBeGreaterThan(2);
    expect(s.support).toBeLessThan(s.resistance);
  });
  it("detects liquidity sweep independently of closes outside range", () => {
    const c = candles();
    const sup = structure(c).support;
    c[c.length - 1] = {
      ...c.at(-1)!,
      low: sup - 2,
      open: sup + 1,
      close: sup + 2,
      high: sup + 3,
    };
    expect(structure(c).sweep).toBe("BUY");
  });
  it("detects a retest against the level before breakout, without including breakout high", () => {
    const c = candles().map((c) => ({
      ...c,
      open: 100,
      close: 100,
      high: 101,
      low: 99,
    }));
    c[c.length - 2] = {
      ...c.at(-2)!,
      open: 100,
      close: 103,
      high: 104,
      low: 99.8,
    };
    c[c.length - 1] = {
      ...c.at(-1)!,
      open: 101,
      close: 102,
      high: 103,
      low: 100.9,
    };
    expect(structure(c).retest).toBe("BUY");
    expect(structure(c).retestResistance).toBe(101);
  });
  it("rejects malformed candles and invalid weight snapshots", () => {
    expect(() => candleSchema.parse({ ...candles()[0], high: 0 })).toThrow();
    expect(() =>
      configSchema.parse({ ...defaultConfig, confidenceWeights: [30, 40, 40] }),
    ).toThrow();
  });
});
describe("Scanner telemetry and group trigger contract", () => {
  it("keeps legacy config snapshots compatible with minimum 2", () => {
    const { scannerConsensusMin: _minimum, ...legacy } = defaultConfig;
    expect(configSchema.parse(legacy).scannerConsensusMin).toBe(2);
  });
  it.each([0, 5, 2.5, "4", null])(
    "rejects invalid four-group consensus minimum %s",
    (minimum) => {
      expect(
        configSchema.safeParse({
          ...defaultConfig,
          scannerConsensusMin: minimum,
        }).success,
      ).toBe(false);
    },
  );
  it("keeps six deterministic scanners as telemetry", () => {
    const output = scan(market, defaultConfig, "TRADING-CONFIG-v1", 42);
    expect(output.map((s) => s.name)).toEqual([...scannerNames]);
    for (const s of output) {
      expect(s.reasons.length).toBeGreaterThan(0);
      expect(s.config_version).toBe("TRADING-CONFIG-v1");
      expect(s.indicators).toHaveProperty("H1");
      expect(s.candle_timestamp).toBe(market.M5.at(-1)!.timestamp);
    }
  });
  it("builds four deterministic groups and assigns two analysts each", () => {
    const scannerOutput = scan(market, defaultConfig, "v1", 42);
    const output = analyzeGroups(market, scannerOutput, defaultConfig, "v1", 42);
    expect(output.map((group) => group.group)).toEqual([...analysisGroups]);
    expect((["structure", "liquidity"] as const).map(analystGroup)).toEqual([
      "SMC_ICT",
      "SMC_ICT",
    ]);
    expect((["trend", "momentum"] as const).map(analystGroup)).toEqual([
      "INDICATORS",
      "INDICATORS",
    ]);
    expect((["volume", "quant"] as const).map(analystGroup)).toEqual([
      "VOLUME",
      "VOLUME",
    ]);
    expect((["derivatives", "positioning"] as const).map(analystGroup)).toEqual([
      "DERIVATIVES_POSITIONING",
      "DERIVATIVES_POSITIONING",
    ]);
    expect(analystGroup("risk")).toBeNull();
    expect(analystGroup("boss")).toBeNull();
  });
  it.each([
    [["BUY", "BUY", "NONE", "NONE"], 2, "BUY"],
    [["SELL", "NONE", "SELL", "NONE"], 2, "SELL"],
    [["BUY", "SELL", "NONE", "NONE"], 2, null],
    [["BUY", "BUY", "SELL", "NONE"], 3, null],
    [["BUY", "BUY", "BUY", "NONE"], 3, "BUY"],
    [["BUY", "BUY", "SELL", "SELL"], 2, null],
  ] as const)("uses true group consensus %j minimum %s → %s", (input, minimum, expected) => {
    expect(groupTrigger(groups([...input]), minimum)).toBe(expected);
  });
  it("keeps legacy six-scanner trigger available only as diagnostic behavior", () => {
    expect(
      trigger(scanners(["BUY", "BUY", "SELL", "SELL", "NONE", "NONE"])),
    ).toBeNull();
  });
  it("builds a dedicated analyst context without unrelated scanner payloads", () => {
    const scannerOutput = scan(market, defaultConfig, "v1");
    const group = analyzeGroups(market, scannerOutput, defaultConfig, "v1")[0];
    const context = buildGroupContext(market, group, defaultConfig);
    expect(context.specialization).toBe("SMC_ICT");
    expect(context.deterministic_snapshot.group).toBe("SMC_ICT");
    expect(context).not.toHaveProperty("scanners");
    expect(context.recent_candles.M5.length).toBeLessThanOrEqual(36);
  });
});
describe("Consensus and confidence", () => {
  it("NO_TRADE abstains and one analyst has one vote", () =>
    expect(
      voting(
        analysts(["BUY", "BUY", "SELL", "NO_TRADE", "NO_TRADE", "NO_TRADE", "NO_TRADE", "NO_TRADE"]),
        "SELL",
        "SELL",
      ).direction,
    ).toBe("BUY"));
  it("uses scanner for all NO_TRADE and <3 successful analysts", () => {
    expect(voting(analysts(Array(8).fill("NO_TRADE")), "SELL").direction).toBe(
      "SELL",
    );
    const d = voting(
      analysts([
        "BUY",
        "BUY",
        "UNAVAILABLE",
        "UNAVAILABLE",
        "UNAVAILABLE",
        "UNAVAILABLE",
        "UNAVAILABLE",
        "UNAVAILABLE",
      ]),
      "SELL",
    );
    expect(d.direction).toBe("SELL");
    expect(d.flags).toContain("AI_DEGRADED");
  });
  it("boss resolves tie; no scanner and NO_TRADE boss means no consensus", () => {
    const a = analysts(["BUY", "BUY", "BUY", "SELL", "SELL", "SELL", "NO_TRADE", "NO_TRADE"]);
    expect(voting(a, "SELL", "BUY").direction).toBe("BUY");
    expect(voting(a, null).direction).toBeNull();
  });
  it("fixed denominators and exact weighted formula; model confidence ignored", () => {
    const g = groups(["BUY", "BUY", "SELL", "NONE"]),
      a = analysts([
        "BUY",
        "BUY",
        "BUY",
        "BUY",
        "SELL",
        "SELL",
        "UNAVAILABLE",
        "UNAVAILABLE",
      ]);
    const c = confidence("BUY", g, a, ["BUY", "NONE", "SELL"], defaultConfig);
    expect(c.scanner).toBe(50);
    expect(c.ai).toBe(50);
    expect(c.mtf).toBe(52.5);
    expect(c.total).toBeCloseTo(50.75);
    a.forEach((x) => {
      if (x.output) x.output.confidence = 0;
    });
    expect(
      confidence("BUY", g, a, ["BUY", "NONE", "SELL"], defaultConfig),
    ).toEqual(c);
  });
});
describe("Risk and context", () => {
  it.each(["BUY", "SELL"] as const)(
    "structural %s risk uses midpoint and honest RR",
    (d) => {
      const r = risk(d, market, defaultConfig);
      expect(r.preferred_entry).toBe((r.entry_low + r.entry_high) / 2);
      expect(r.risk_reward).toBe(
        Math.abs(r.take_profit - r.preferred_entry) /
          Math.abs(r.preferred_entry - r.stop_loss),
      );
      if (d === "BUY") {
        expect(r.stop_loss).toBeLessThan(r.entry_low);
        expect(r.take_profit).toBeGreaterThan(r.entry_high);
      } else {
        expect(r.stop_loss).toBeGreaterThan(r.entry_high);
        expect(r.take_profit).toBeLessThan(r.entry_low);
      }
    },
  );
  it("flags LOW_RR without manufacturing a TP", () => {
    const highMin = { ...defaultConfig, minRR: 10 };
    const normal = risk("BUY", market, defaultConfig),
      r = risk("BUY", market, highMin);
    expect(r.take_profit).toBe(normal.take_profit);
    expect(r.flags).toContain("LOW_RR");
  });
  it("compresses oldest raw candles and keeps latest timestamp", () => {
    const config = {
      ...defaultConfig,
      context: { ...defaultConfig.context, maxChars: 18000 },
    };
    const s = scan(market, config, "v1");
    const result = buildContext(market, s, config);
    expect(result.context_compressed).toBe(true);
    expect(result.payload.candles.M5.at(-1)).toEqual(market.M5.at(-1));
    expect(JSON.stringify(result.payload).length).toBeLessThanOrEqual(18000);
  });
  it("semantic validation flags explicit opposing directional evidence", () =>
    expect(
      semanticErrors(
        analysisSchema.parse({
          vote: "BUY",
          confidence: 50,
          summary: "x",
          reasoning: "x",
          evidence: [
            { code: "DIRECTIONAL_BIAS", direction: "SELL", detail: "x" },
          ],
          risk_flags: [],
        }),
      ),
    ).toHaveLength(1));
  it("WIB IDs roll over at UTC 17:00", () => {
    expect(wibDate(Date.parse("2026-10-03T16:59:59Z"))).toBe("20261003");
    expect(wibDate(Date.parse("2026-10-03T17:00:00Z"))).toBe("20261004");
    expect(formatPrice(1.1234, 0.0001)).toBe("1.1234");
  });
  it.each([
    ["BUY", 99, 101, 0],
    ["SELL", 101, 99, 0],
    ["BUY", 101, 102, 1],
    ["SELL", 99, 98, 1],
    ["BUY", 98, 99, 1],
    ["SELL", 102, 101, 1],
    ["BUY", 100, 101, 1],
    ["SELL", 101, 100, 1],
  ])(
    "validates %s price relationships SL=%s TP=%s",
    (vote, stop_loss, take_profit, errors) => {
      const output = analysisSchema.parse({
        vote,
        confidence: 72,
        summary: "Price plan",
        reasoning: "Supplied levels",
        evidence: [],
        risk_flags: [],
        price_levels: { entry: 100, stop_loss, take_profit },
      });
      expect(semanticErrors(output)).toHaveLength(errors as number);
      expect(output.confidence).toBe(72);
    },
  );
  it("allows omitted/null prices and NO_TRADE without imposing a direction", () => {
    for (const price_levels of [
      undefined,
      null,
      { entry: 100, stop_loss: 101, take_profit: 102 },
    ]) {
      const output = analysisSchema.parse({
        vote: "NO_TRADE",
        confidence: 70,
        summary: "Abstain",
        reasoning: "No plan",
        evidence: [],
        risk_flags: [],
        price_levels,
      });
      expect(semanticErrors(output)).toEqual([]);
    }
  });
  it("rejects nonfinite and nonpositive price levels structurally", () => {
    for (const entry of [0, -1, Infinity, NaN])
      expect(() =>
        analysisSchema.parse({
          vote: "BUY",
          confidence: 70,
          summary: "Invalid",
          reasoning: "Bad prices",
          evidence: [],
          risk_flags: [],
          price_levels: { entry, stop_loss: 99, take_profit: 101 },
        }),
      ).toThrow();
  });
});
