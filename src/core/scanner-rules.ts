import { z } from "zod";

export const numericRuleFields = [
  "price",
  "previousClose",
  "ema20",
  "ema50",
  "ema200",
  "rsi",
  "adx",
  "atr",
  "volumeRatio",
  "body",
  "roc",
  "macdHistogram",
  "bbUpper",
  "bbLower",
  "displacementAtr",
] as const;
export const directionRuleFields = [
  "bias",
  "structureBias",
  "breakout",
  "retest",
  "bos",
  "choch",
  "sweep",
  "fvg",
] as const;
const fieldSchema = z
  .object({
    timeframe: z.enum(["H1", "M15", "M5"]),
    field: z.enum([...numericRuleFields, ...directionRuleFields]),
  })
  .strict();
export type RuleField = z.infer<typeof fieldSchema>;
export const ruleConditionSchema = z
  .object({
    left: fieldSchema,
    operator: z.enum([">", ">=", "<", "<=", "==", "!="]),
    right: z.union([
      z.number().finite(),
      z.enum(["BUY", "SELL", "NONE"]),
      fieldSchema,
    ]),
  })
  .strict()
  .superRefine((condition, ctx) => {
    const directional = (field: string) =>
      (directionRuleFields as readonly string[]).includes(field);
    const leftDirection = directional(condition.left.field);
    const rightDirection =
      typeof condition.right === "string" ||
      (typeof condition.right === "object" &&
        directional(condition.right.field));
    if (
      leftDirection !== rightDirection ||
      (leftDirection && !["==", "!="].includes(condition.operator))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Bandingkan indikator numerik dengan angka/indikator numerik, dan arah dengan BUY/SELL/NONE memakai == atau !=.",
      });
  });
const sideSchema = z
  .object({
    match: z.enum(["ALL", "ANY"]),
    conditions: z.array(ruleConditionSchema).min(1).max(12),
  })
  .strict();
export const scannerRuleSchema = z
  .object({
    mode: z.enum(["CUSTOM", "DISABLED"]),
    buy: sideSchema,
    sell: sideSchema,
  })
  .strict();
export type ScannerRule = z.infer<typeof scannerRuleSchema>;
export type RuleCondition = z.infer<typeof ruleConditionSchema>;
export type RuleFacts = Record<
  "H1" | "M15" | "M5",
  Record<string, number | string>
>;

export function evaluateScannerRule(
  rule: ScannerRule,
  facts: RuleFacts,
): "BUY" | "SELL" | "NONE" {
  if (rule.mode === "DISABLED") return "NONE";
  const matches = (side: ScannerRule["buy"]) => {
    const values = side.conditions.map(({ left, operator, right }) => {
      const a = facts[left.timeframe][left.field];
      const b =
        typeof right === "object" ? facts[right.timeframe][right.field] : right;
      if (a === undefined || b === undefined || typeof a !== typeof b)
        return false;
      if (typeof a === "number" && (!Number.isFinite(a) || !Number.isFinite(b)))
        return false;
      switch (operator) {
        case "==":
          return a === b;
        case "!=":
          return a !== b;
        case ">":
          return typeof a === "number" && typeof b === "number" && a > b;
        case ">=":
          return typeof a === "number" && typeof b === "number" && a >= b;
        case "<":
          return typeof a === "number" && typeof b === "number" && a < b;
        case "<=":
          return typeof a === "number" && typeof b === "number" && a <= b;
      }
    });
    return (
      values.length > 0 &&
      (side.match === "ALL" ? values.every(Boolean) : values.some(Boolean))
    );
  };
  const buy = matches(rule.buy),
    sell = matches(rule.sell);
  return buy === sell ? "NONE" : buy ? "BUY" : "SELL";
}
export function exampleScannerRule(): ScannerRule {
  return {
    mode: "CUSTOM",
    buy: {
      match: "ALL",
      conditions: [
        { left: { timeframe: "M5", field: "rsi" }, operator: ">=", right: 55 },
      ],
    },
    sell: {
      match: "ALL",
      conditions: [
        { left: { timeframe: "M5", field: "rsi" }, operator: "<=", right: 45 },
      ],
    },
  };
}
