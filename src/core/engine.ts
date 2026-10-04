import {
  adx,
  atr,
  bollinger,
  ema,
  macd,
  mean,
  roc,
  rsi,
  structure,
} from "./indicators";
import {
  defaultConfig,
  scannerNames,
  scannerOutputSchema,
  type AnalystResult,
  type Direction,
  type MarketContext,
  type Risk,
  type ScannerOutput,
  type TradeDirection,
  type TradingConfig,
} from "./contracts";
export function indicators(c: MarketContext["M5"], config: TradingConfig) {
  const v = c.map((x) => x.close),
    last = c.at(-1)!;
  const e = config.scanner.ema.map((p) => ema(v, p).at(-1)!);
  return {
    ema20: e[0],
    ema50: e[1],
    ema200: e[2],
    rsi: rsi(v, config.scanner.period),
    adx: adx(c, config.scanner.period),
    atr: atr(c, config.atrPeriod),
    macd: macd(v),
    roc: roc(v),
    bb: bollinger(v, 20, config.scanner.bbDeviation),
    volumeRatio:
      last.volume / (mean(c.slice(-21, -1).map((x) => x.volume)) || 1),
    body: last.close - last.open,
    price: last.close,
    structure: structure(c, config.scanner.structureWindow),
  };
}
export function bias(i: ReturnType<typeof indicators>): Direction {
  return i.price > i.ema50 && i.ema20 > i.ema50
    ? "BUY"
    : i.price < i.ema50 && i.ema20 < i.ema50
      ? "SELL"
      : "NONE";
}
export function scan(
  context: MarketContext,
  config: TradingConfig,
  version: string,
  now = Date.now(),
): ScannerOutput[] {
  const h = indicators(context.H1, config),
    m = indicators(context.M15, config),
    f = indicators(context.M5, config),
    hb = bias(h),
    mb = bias(m),
    fb = bias(f),
    s = f.structure;
  const rules: Record<(typeof scannerNames)[number], Direction> = {
    trend:
      h.adx >= config.scanner.adxMin &&
      hb === mb &&
      mb === fb &&
      (hb === "BUY"
        ? h.ema50 > h.ema200
        : hb === "SELL"
          ? h.ema50 < h.ema200
          : false)
        ? hb
        : "NONE",
    breakout:
      f.volumeRatio >= config.scanner.volumeRatio &&
      (s.breakout !== "NONE" || s.retest !== "NONE")
        ? s.retest !== "NONE"
          ? s.retest
          : s.breakout
        : "NONE",
    momentum:
      f.volumeRatio >= config.scanner.volumeRatio &&
      f.rsi >= config.scanner.momentumRsi[0] &&
      f.macd.histogram > 0 &&
      f.roc > 0 &&
      f.body > 0 &&
      mb === "BUY"
        ? "BUY"
        : f.volumeRatio >= config.scanner.volumeRatio &&
            f.rsi <= config.scanner.momentumRsi[1] &&
            f.macd.histogram < 0 &&
            f.roc < 0 &&
            f.body < 0 &&
            mb === "SELL"
          ? "SELL"
          : "NONE",
    "mean-reversion":
      context.M5.at(-2)!.close < f.bb.lower &&
      f.rsi < config.scanner.reversionRsi[0] &&
      f.body > 0
        ? "BUY"
        : context.M5.at(-2)!.close > f.bb.upper &&
            f.rsi > config.scanner.reversionRsi[1] &&
            f.body < 0
          ? "SELL"
          : "NONE",
    structure:
      s.choch !== "NONE"
        ? s.choch
        : s.bos !== "NONE" && s.bos === m.structure.bias
          ? s.bos
          : s.bias === m.structure.bias
            ? s.bias
            : "NONE",
    liquidity:
      s.sweep !== "NONE" &&
      Math.abs(f.body) > f.atr * config.scanner.displacementAtr &&
      ((s.sweep === "BUY" && f.body > 0) || (s.sweep === "SELL" && f.body < 0))
        ? s.sweep
        : s.fvg !== "NONE" &&
            s.orderBlock &&
            Math.abs(f.body) > f.atr * config.scanner.displacementAtr
          ? s.fvg
          : "NONE",
  };
  return scannerNames
    .map((name) => ({
      name,
      direction: rules[name],
      strength:
        rules[name] === "NONE"
          ? 0
          : Math.min(100, Math.round(50 + Math.min(f.adx, 50))),
      h1_bias: hb,
      m15_setup: mb,
      m5_trigger: fb,
      reasons: [
        rules[name] === "NONE"
          ? `${name}: confirmation criteria not met`
          : `${name}: ${rules[name]} confirmed by configured deterministic rules`,
      ],
      levels: [
        m.structure.support,
        m.structure.resistance,
        f.structure.support,
        f.structure.resistance,
      ],
      indicators: { H1: h, M15: m, M5: f },
      timestamp: now,
      candle_timestamp: context.M5.at(-1)!.timestamp,
      config_version: version,
    }))
    .map((s) => scannerOutputSchema.parse(s));
}
export function composition(scanners: ScannerOutput[]) {
  return scanners.reduce(
    (a, s) => {
      a[s.direction]++;
      return a;
    },
    { BUY: 0, SELL: 0, NONE: 0 },
  );
}
export function trigger(
  scanners: ScannerOutput[],
  minimum = defaultConfig.scannerConsensusMin,
): TradeDirection | null {
  const c = composition(scanners);
  return c.BUY >= minimum && c.BUY > c.SELL
    ? "BUY"
    : c.SELL >= minimum && c.SELL > c.BUY
      ? "SELL"
      : null;
}
export function voting(
  results: AnalystResult[],
  scanner: TradeDirection | null,
  boss: "BUY" | "SELL" | "NO_TRADE" = "NO_TRADE",
) {
  const counts = { BUY: 0, SELL: 0, NO_TRADE: 0, UNAVAILABLE: 0 };
  for (const r of results) counts[r.output?.vote ?? "UNAVAILABLE"]++;
  counts.UNAVAILABLE += Math.max(0, 6 - results.length);
  const success = counts.BUY + counts.SELL + counts.NO_TRADE;
  const degraded = success < 3;
  let direction: TradeDirection | null = null;
  const flags: string[] = [];
  if (degraded) {
    direction = scanner;
    flags.push("AI_DEGRADED", "SCANNER_FALLBACK");
  } else if (counts.BUY > counts.SELL) direction = "BUY";
  else if (counts.SELL > counts.BUY) direction = "SELL";
  else if (counts.NO_TRADE === 6) {
    direction = scanner;
    flags.push("SCANNER_FALLBACK");
  } else if (boss !== "NO_TRADE") direction = boss;
  else {
    direction = scanner;
    if (scanner) flags.push("SCANNER_FALLBACK");
  }
  return {
    direction,
    counts,
    flags,
    degraded,
    tie: success >= 3 && counts.BUY === counts.SELL && counts.NO_TRADE !== 6,
  };
}
export function confidence(
  direction: TradeDirection,
  scanners: ScannerOutput[],
  analysts: AnalystResult[],
  mtf: Direction[],
  config: TradingConfig,
) {
  if (scanners.length !== 6 || analysts.length !== 6 || mtf.length !== 3)
    throw new Error("Confidence requires 6 scanners, 6 analysts, 3 timeframes");
  const sc =
      (scanners.filter((s) => s.direction === direction).length / 6) * 100,
    ai =
      (analysts.filter((a) => a.output?.vote === direction).length / 6) * 100;
  const alignment = mtf.reduce(
    (sum, d, i) =>
      sum +
      ((d === direction ? 100 : d === "NONE" ? config.neutralScore : 0) *
        config.mtfWeights[i]) /
        100,
    0,
  );
  return {
    scanner: sc,
    ai,
    mtf: alignment,
    total:
      (sc * config.confidenceWeights[0] +
        ai * config.confidenceWeights[1] +
        alignment * config.confidenceWeights[2]) /
      100,
  };
}
export function risk(
  direction: TradeDirection,
  context: MarketContext,
  config: TradingConfig,
): Risk {
  const m = context.M15,
    s = structure(m, config.scanner.structureWindow),
    vol = atr(m, config.atrPeriod);
  const price = m.at(-1)!.close;
  const supports = [...s.lows, s.support]
      .filter((x) => x < price)
      .sort((a, b) => b - a),
    resistances = [...s.highs, s.resistance]
      .filter((x) => x > price)
      .sort((a, b) => a - b);
  const anchor = direction === "BUY" ? supports[0] : resistances[0];
  if (anchor === undefined || !vol) throw new Error("No valid entry structure");
  const low = anchor - vol * config.entryAtr,
    high = anchor + vol * config.entryAtr,
    entry = (low + high) / 2;
  const stop =
    direction === "BUY"
      ? Math.min(
          anchor,
          ...m.slice(-config.scanner.structureWindow).map((c) => c.low),
        ) -
        vol * config.slAtr
      : Math.max(
          anchor,
          ...m.slice(-config.scanner.structureWindow).map((c) => c.high),
        ) +
        vol * config.slAtr;
  const major = structure(context.H1, config.scanner.structureWindow);
  const targets =
    direction === "BUY"
      ? [...s.highs, s.resistance, ...major.highs, major.resistance]
          .filter((x) => x > high)
          .sort((a, b) => a - b)
      : [...s.lows, s.support, ...major.lows, major.support]
          .filter((x) => x < low)
          .sort((a, b) => b - a);
  const tp = targets[0];
  if (tp === undefined || (direction === "BUY" ? stop >= low : stop <= high))
    throw new Error("No valid structural SL/TP");
  const rr = Math.abs(tp - entry) / Math.abs(entry - stop);
  return {
    entry_low: low,
    entry_high: high,
    preferred_entry: entry,
    stop_loss: stop,
    take_profit: tp,
    risk_reward: rr,
    flags: rr < config.minRR ? ["LOW_RR"] : [],
    basis: {
      atr: vol,
      anchor,
      structure: s,
      h1: major,
      m5: structure(context.M5, config.scanner.structureWindow),
    },
  };
}
export function semanticErrors(output: AnalystResult["output"]) {
  if (!output) return ["No structured output"];
  if (output.vote === "NO_TRADE") return [];
  const opposing = output.vote === "BUY" ? "SELL" : "BUY";
  const errors = output.evidence
    .filter((e) => e.code === "DIRECTIONAL_BIAS" && e.direction === opposing)
    .map(() => "Vote contradicts explicit directional bias evidence");
  const levels = output.price_levels;
  if (levels) {
    if (
      output.vote === "BUY"
        ? levels.stop_loss >= levels.entry || levels.take_profit <= levels.entry
        : levels.stop_loss <= levels.entry || levels.take_profit >= levels.entry
    )
      errors.push(
        "Price levels contradict vote: BUY requires SL < entry < TP; SELL requires TP < entry < SL",
      );
  }
  return errors;
}
export function buildContext(
  context: MarketContext,
  scanners: ScannerOutput[],
  config: TradingConfig,
) {
  const raw = {
    H1: context.H1.slice(-config.context.H1),
    M15: context.M15.slice(-config.context.M15),
    M5: context.M5.slice(-config.context.M5),
  };
  const summaries = Object.fromEntries(
    Object.entries(context).map(([k, v]) => [
      k,
      {
        count: v.length,
        high: Math.max(...v.map((c) => c.high)),
        low: Math.min(...v.map((c) => c.low)),
        volume: v.reduce((a, c) => a + c.volume, 0),
      },
    ]),
  );
  let compressed = false;
  const indicatorSnapshots: Record<string, unknown>[] = [];
  const scannerContext = scanners.map((s) => {
    let index = indicatorSnapshots.findIndex(
      (v) => JSON.stringify(v) === JSON.stringify(s.indicators),
    );
    if (index < 0) {
      index = indicatorSnapshots.length;
      indicatorSnapshots.push(s.indicators);
    }
    const { indicators: _indicators, ...rest } = s;
    return { ...rest, indicator_snapshot: index };
  });
  let payload = {
    candles: raw,
    summaries,
    scanners: scannerContext,
    indicatorSnapshots,
  };
  while (
    JSON.stringify(payload).length > config.context.maxChars &&
    Math.max(...Object.values(raw).map((c) => c.length)) > 10
  ) {
    compressed = true;
    for (const key of ["H1", "M15", "M5"] as const)
      raw[key] = raw[key].slice(
        -Math.max(10, Math.floor(raw[key].length * 0.7)),
      );
    payload = {
      candles: raw,
      summaries,
      scanners: scannerContext,
      indicatorSnapshots,
    };
  }
  if (JSON.stringify(payload).length > config.context.maxChars)
    throw new Error("Context exceeds configured limit even after compression");
  return { payload, context_compressed: compressed };
}
