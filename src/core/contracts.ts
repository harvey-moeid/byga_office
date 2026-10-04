import { z } from "zod";
export const directionSchema = z.enum(["BUY", "SELL", "NONE"]);
export type Direction = z.infer<typeof directionSchema>;
export type TradeDirection = Exclude<Direction, "NONE">;
export const timeframes = ["H1", "M15", "M5"] as const;
export type Timeframe = (typeof timeframes)[number];
export const candleSchema = z
  .object({
    timestamp: z.number().int().nonnegative(),
    open: z.number().finite().positive(),
    high: z.number().finite().positive(),
    low: z.number().finite().positive(),
    close: z.number().finite().positive(),
    volume: z.number().finite().nonnegative(),
  })
  .superRefine((c, ctx) => {
    if (
      c.high < Math.max(c.open, c.close, c.low) ||
      c.low > Math.min(c.open, c.close)
    )
      ctx.addIssue({ code: "custom", message: "Invalid OHLC range" });
  });
export type Candle = z.infer<typeof candleSchema>;
export type MarketContext = Record<Timeframe, Candle[]>;
const weights = z
  .tuple([
    z.number().min(0).max(100),
    z.number().min(0).max(100),
    z.number().min(0).max(100),
  ])
  .refine(
    (v) => Math.abs(v.reduce((a, b) => a + b, 0) - 100) < 1e-6,
    "Weights must total 100",
  );
export const configSchema = z.object({
  scanner: z.object({
    ema: z.tuple([
      z.number().int().min(2).max(500),
      z.number().int().min(2).max(500),
      z.number().int().min(2).max(500),
    ]),
    period: z.number().int().min(2).max(100),
    adxMin: z.number().min(0).max(100),
    volumeRatio: z.number().positive().max(10),
    momentumRsi: z.tuple([
      z.number().min(0).max(100),
      z.number().min(0).max(100),
    ]),
    reversionRsi: z.tuple([
      z.number().min(0).max(100),
      z.number().min(0).max(100),
    ]),
    bbDeviation: z.number().positive().max(5),
    structureWindow: z.number().int().min(5).max(200),
    displacementAtr: z.number().positive().max(10),
  }),
  atrPeriod: z.number().int().min(2).max(100),
  entryAtr: z.number().positive().max(3),
  slAtr: z.number().positive().max(5),
  minRR: z.number().positive().max(10),
  confidenceWeights: weights,
  mtfWeights: weights,
  neutralScore: z.number().min(0).max(100),
  cooldownMinutes: z.number().min(0).max(1440),
  cooldownAnchor: z.enum(["FROM_TRIGGER", "FROM_FINAL_DECISION"]),
  processingDelaySeconds: z.number().min(1).max(120),
  context: z.object({
    H1: z.number().int().min(10).max(500),
    M15: z.number().int().min(10).max(500),
    M5: z.number().int().min(10).max(500),
    maxChars: z.number().int().min(5000).max(200000),
  }),
  publicSignals: z.boolean(),
  publicHistory: z.boolean(),
  historyLimit: z.number().int().min(1).max(10000),
  notifyNoConsensus: z.boolean(),
  retentionDays: z.number().int().min(1).max(3650),
  budgets: z.object({
    casesPerDay: z.number().int().nonnegative(),
    callsPerCase: z.number().int().nonnegative(),
    tokensPerCase: z.number().int().nonnegative(),
    emergenciesPerDay: z.number().int().nonnegative(),
    simulationsPerDay: z.number().int().nonnegative(),
  }),
});
export type TradingConfig = z.infer<typeof configSchema>;
export const defaultConfig: TradingConfig = {
  scanner: {
    ema: [20, 50, 200],
    period: 14,
    adxMin: 20,
    volumeRatio: 1,
    momentumRsi: [55, 45],
    reversionRsi: [30, 70],
    bbDeviation: 2,
    structureWindow: 20,
    displacementAtr: 1,
  },
  atrPeriod: 14,
  entryAtr: 0.15,
  slAtr: 0.5,
  minRR: 1.5,
  confidenceWeights: [30, 40, 30],
  mtfWeights: [30, 45, 25],
  neutralScore: 50,
  cooldownMinutes: 15,
  cooldownAnchor: "FROM_TRIGGER",
  processingDelaySeconds: 5,
  context: { H1: 50, M15: 100, M5: 100, maxChars: 60000 },
  publicSignals: false,
  publicHistory: true,
  historyLimit: 500,
  notifyNoConsensus: false,
  retentionDays: 90,
  budgets: {
    casesPerDay: 0,
    callsPerCase: 0,
    tokensPerCase: 0,
    emergenciesPerDay: 0,
    simulationsPerDay: 0,
  },
};
export const scannerNames = [
  "trend",
  "breakout",
  "momentum",
  "mean-reversion",
  "structure",
  "liquidity",
] as const;
export type ScannerName = (typeof scannerNames)[number];
export interface ScannerOutput {
  name: ScannerName;
  direction: Direction;
  strength: number;
  h1_bias: Direction;
  m15_setup: Direction;
  m5_trigger: Direction;
  reasons: string[];
  levels: number[];
  indicators: Record<string, unknown>;
  timestamp: number;
  candle_timestamp: number;
  config_version: string;
}
export const scannerOutputSchema = z.object({
  name: z.enum(scannerNames),
  direction: directionSchema,
  strength: z.number().finite().min(0).max(100),
  h1_bias: directionSchema,
  m15_setup: directionSchema,
  m5_trigger: directionSchema,
  reasons: z.array(z.string()).min(1),
  levels: z.array(z.number().finite()),
  indicators: z.record(z.unknown()),
  timestamp: z.number().int().nonnegative(),
  candle_timestamp: z.number().int().nonnegative(),
  config_version: z.string().min(1),
});
export const providers = [
  "openai",
  "gemini",
  "groq",
  "openrouter",
  "mistral",
  "huggingface",
  "cohere",
  "nvidia",
] as const;
export type Provider = (typeof providers)[number];
export const characterIds = [
  "trend",
  "structure",
  "momentum",
  "liquidity",
  "volume",
  "quant",
  "risk",
  "boss",
] as const;
export type CharacterId = (typeof characterIds)[number];
export const avatarPresets = [
  "professional",
  "emerald",
  "navy",
  "gold",
  "plum",
] as const;
export type AvatarPreset = (typeof avatarPresets)[number];
export const characterSchema = z.object({
  id: z.enum(characterIds),
  primary_provider: z.enum(providers),
  primary_model: z.string().min(1).max(200),
  fallback_provider: z.enum(providers),
  fallback_model: z.string().min(1).max(200),
  temperature: z.number().min(0).max(2),
  max_output_tokens: z.number().int().min(200).max(8000),
  primary_timeout: z.number().min(1000).max(120000),
  fallback_timeout: z.number().min(1000).max(120000),
  custom_instructions: z.string().max(8000),
  personality: z.string().max(2000),
  avatar: z.enum(avatarPresets),
  prompt_version: z.string().min(1),
});
export type CharacterConfig = z.infer<typeof characterSchema>;
export function defaultCharacters(): CharacterConfig[] {
  return characterIds.map((id) => ({
    id,
    primary_provider: "openai",
    primary_model: "gpt-4.1-mini",
    fallback_provider: "gemini",
    fallback_model: "gemini-2.5-flash",
    temperature: 0.2,
    max_output_tokens: id === "risk" || id === "boss" ? 2000 : 1500,
    primary_timeout: 30000,
    fallback_timeout: 30000,
    custom_instructions: "",
    personality: "Professional, concise, evidence-led.",
    avatar: "professional",
    prompt_version: `${id}-v1`,
  }));
}
export const analysisSchema = z.object({
  vote: z.enum(["BUY", "SELL", "NO_TRADE"]),
  confidence: z.number().min(0).max(100),
  summary: z.string().min(1).max(2000),
  reasoning: z.string().min(1).max(6000),
  evidence: z
    .array(
      z.object({
        code: z.string().min(1).max(100),
        direction: directionSchema,
        detail: z.string().max(1000),
      }),
    )
    .max(30),
  risk_flags: z.array(z.string().max(100)).max(20),
  price_levels: z
    .object({
      entry: z.number().finite().positive(),
      stop_loss: z.number().finite().positive(),
      take_profit: z.number().finite().positive(),
    })
    .nullable()
    .optional(),
});
export type Analysis = z.infer<typeof analysisSchema>;
export interface AnalystResult {
  id: CharacterId;
  status: "SUCCESS" | "UNAVAILABLE" | "TIMEOUT";
  output?: Analysis;
  flags: string[];
  validationErrors: string[];
  provider?: Provider;
  model?: string;
  prompt_version: string;
}
export interface Risk {
  entry_low: number;
  entry_high: number;
  preferred_entry: number;
  stop_loss: number;
  take_profit: number;
  risk_reward: number;
  flags: string[];
  basis: Record<string, unknown>;
}
export interface Signal extends Risk {
  signal_uuid: string;
  signal_id: string;
  case_uuid: string;
  case_id: string;
  market: "BTCUSDT";
  direction: TradeDirection;
  confidence: number;
  h1_bias: Direction;
  m15_setup: Direction;
  m5_trigger: Direction;
  scanner_composition: Record<Direction, number>;
  ai_vote_composition: Record<string, number>;
  source: "AUTO" | "EMERGENCY";
  created_at: number;
  config_version: string;
  boss_summary: string;
  minimum_risk_reward: number;
  tick_size: number;
}
export function wibDate(t = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(t)
    .replaceAll("-", "");
}
export function formatWib(t: number) {
  return (
    new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      dateStyle: "medium",
      timeStyle: "medium",
    }).format(t) + " WIB"
  );
}
export function formatPrice(value: number, tickSize = 0.01) {
  const [coefficient, exponent = "0"] = String(tickSize).split("e");
  const digits = Math.min(
    12,
    Math.max(0, (coefficient.split(".")[1] || "").length - Number(exponent)),
  );
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
