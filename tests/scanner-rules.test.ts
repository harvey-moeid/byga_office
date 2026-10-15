import { describe, expect, it } from "vitest";
import {
  configSchema,
  defaultConfig,
  type MarketContext,
} from "../src/core/contracts";
import { scan } from "../src/core/engine";
import {
  evaluateScannerRule,
  exampleScannerRule,
  scannerRuleSchema,
  type RuleFacts,
} from "../src/core/scanner-rules";
const facts: RuleFacts = {
  H1: { rsi: 65, price: 120 },
  M15: { price: 100 },
  M5: { rsi: 60, bias: "BUY", price: 110 },
};
describe("custom deterministic scanner rules", () => {
  it("supports separate BUY/SELL, ALL/ANY, cross-timeframe metrics and neutral conflicts", () => {
    const rule = exampleScannerRule();
    expect(evaluateScannerRule(rule, facts)).toBe("BUY");
    expect(evaluateScannerRule(rule, { ...facts, M5: { rsi: 30 } })).toBe(
      "SELL",
    );
    rule.buy.conditions.push({
      left: { timeframe: "M5", field: "price" },
      operator: ">",
      right: { timeframe: "H1", field: "price" },
    });
    expect(evaluateScannerRule(rule, facts)).toBe("NONE");
    rule.buy.match = "ANY";
    expect(evaluateScannerRule(rule, facts)).toBe("BUY");
    rule.sell = structuredClone(rule.buy);
    expect(evaluateScannerRule(rule, facts)).toBe("NONE");
    rule.mode = "DISABLED";
    expect(evaluateScannerRule(rule, facts)).toBe("NONE");
  });
  it("validates supported fields and types, rejects empty rules, code, invalid numbers and oversized rules", () => {
    const rule = exampleScannerRule();
    for (const right of [NaN, Infinity, "process.exit()", "BUY"]) {
      const invalid = structuredClone(rule);
      invalid.buy.conditions[0].right = right as number;
      expect(scannerRuleSchema.safeParse(invalid).success).toBe(false);
    }
    expect(
      scannerRuleSchema.safeParse({
        ...rule,
        buy: { match: "ALL", conditions: [] },
      }).success,
    ).toBe(false);
    expect(
      scannerRuleSchema.safeParse({
        ...rule,
        buy: {
          match: "ALL",
          conditions: Array(13).fill(rule.buy.conditions[0]),
        },
      }).success,
    ).toBe(false);
    expect(
      configSchema.safeParse({ ...defaultConfig, scannerRules: { typo: rule } })
        .success,
    ).toBe(false);
    const directional = structuredClone(rule);
    directional.buy.conditions = [
      {
        left: { timeframe: "M5", field: "bias" },
        operator: "==",
        right: "BUY",
      },
    ];
    expect(scannerRuleSchema.safeParse(directional).success).toBe(true);
    expect(evaluateScannerRule(directional, facts)).toBe("BUY");
    expect(
      evaluateScannerRule(exampleScannerRule(), {
        H1: {},
        M15: {},
        M5: { rsi: NaN },
      }),
    ).toBe("NONE");
  });
  it("applies versioned custom rules in real scan output and preserves built-in defaults", () => {
    const candles = Array.from({ length: 220 }, (_, i) => ({
      timestamp: i * 300000,
      open: 100 + i,
      close: 101 + i,
      high: 102 + i,
      low: 99 + i,
      volume: 1000 + i,
    }));
    const context: MarketContext = { H1: candles, M15: candles, M5: candles };
    const baseline = scan(context, defaultConfig, "v1", 1);
    const custom = exampleScannerRule();
    custom.buy.conditions = [
      { left: { timeframe: "M5", field: "price" }, operator: ">", right: 0 },
    ];
    custom.sell.conditions = [
      { left: { timeframe: "M5", field: "price" }, operator: "<", right: 0 },
    ];
    const config = configSchema.parse({
      ...defaultConfig,
      scannerRules: {
        trend: custom,
        momentum: { ...custom, mode: "DISABLED" },
      },
    });
    const output = scan(context, config, "custom-v2", 1);
    expect(output.find((s) => s.name === "trend")!.direction).toBe("BUY");
    expect(output.find((s) => s.name === "momentum")!.direction).toBe("NONE");
    expect(output.every((s) => s.config_version === "custom-v2")).toBe(true);
    expect(output.find((s) => s.name === "structure")).toEqual({
      ...baseline.find((s) => s.name === "structure"),
      config_version: "custom-v2",
    });
    expect(
      scan(context, { ...defaultConfig, scannerRules: {} }, "v1", 1),
    ).toEqual(baseline);
  });
});
