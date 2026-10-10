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
  MARKET,
  scannerNames,
  scannerOutputSchema,
  type AnalystResult,
  type AnalysisGroup,
  type CharacterId,
  type DerivativesContext,
  type Direction,
  type GroupSnapshot,
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
function directionalWinner(directions: Direction[]): Direction {
  const buy = directions.filter((d) => d === "BUY").length;
  const sell = directions.filter((d) => d === "SELL").length;
  return buy > sell ? "BUY" : sell > buy ? "SELL" : "NONE";
}
function groupStrength(scanners: ScannerOutput[], direction: Direction) {
  if (direction === "NONE") return 0;
  const matching = scanners.filter((s) => s.direction === direction);
  return matching.length
    ? Math.round(matching.reduce((sum, s) => sum + s.strength, 0) / matching.length)
    : 0;
}
function derivativeChange(points: DerivativesContext["open_interest"]) {
  const sample = points.slice(-13);
  const first = sample[0]?.value;
  const last = sample.at(-1)?.value;
  return first && last !== undefined ? ((last - first) / first) * 100 : null;
}
function analyzeDerivatives(
  context: MarketContext,
  derivatives?: DerivativesContext,
): Pick<GroupSnapshot, "direction" | "strength" | "reasons" | "payload"> {
  const candleTimestamp = context.M5.at(-1)!.timestamp;
  const fresh = <T extends { timestamp: number }>(rows: T[], maxAge: number) =>
    rows.filter(
      (row) => row.timestamp <= candleTimestamp && candleTimestamp - row.timestamp <= maxAge,
    );
  const openInterest = fresh(derivatives?.open_interest ?? [], 20 * 60_000);
  const positioning = fresh(derivatives?.long_short_ratio ?? [], 20 * 60_000);
  const liquidations = fresh(derivatives?.liquidation ?? [], 35 * 60_000);
  const funding = fresh(derivatives?.funding_rate ?? [], 12 * 60 * 60_000);
  const priceBase = context.M5.at(-7)?.close ?? context.M5[0].close;
  const price = context.M5.at(-1)!.close;
  const priceChangePct = ((price - priceBase) / priceBase) * 100;
  const oiChangePct = derivativeChange(openInterest);
  const fundingRate = funding.at(-1)?.value ?? null;
  const longShortRatio = positioning.at(-1)?.value ?? null;
  const longLiquidation = liquidations.reduce(
    (sum, row) => sum + Math.max(0, row.value2 ?? 0),
    0,
  );
  const shortLiquidation = liquidations.reduce(
    (sum, row) => sum + Math.max(0, row.value3 ?? 0),
    0,
  );
  let score = 0;
  let components = 0;
  const reasons: string[] = [];
  if (
    oiChangePct !== null &&
    Math.abs(oiChangePct) >= 0.15 &&
    Math.abs(priceChangePct) >= 0.05
  ) {
    const weight = oiChangePct > 0 ? (Math.abs(oiChangePct) >= 1 ? 1.5 : 1) : 0.5;
    score += priceChangePct > 0 ? weight : -weight;
    components++;
    reasons.push(
      `Open interest ${oiChangePct >= 0 ? "+" : ""}${oiChangePct.toFixed(2)}% with price ${priceChangePct >= 0 ? "+" : ""}${priceChangePct.toFixed(2)}%`,
    );
  }
  if (fundingRate !== null && Math.abs(fundingRate) >= 0.0001) {
    score += fundingRate > 0 ? -1 : 1;
    components++;
    reasons.push(
      `Funding ${(fundingRate * 100).toFixed(4)}% indicates ${fundingRate > 0 ? "long" : "short"} crowding`,
    );
  }
  if (longShortRatio !== null && (longShortRatio >= 1.1 || longShortRatio <= 0.9)) {
    score += longShortRatio >= 1.1 ? -1 : 1;
    components++;
    reasons.push(
      `Long/short ratio ${longShortRatio.toFixed(3)} shows ${longShortRatio >= 1.1 ? "long" : "short"} crowding`,
    );
  }
  const liquidationTotal = longLiquidation + shortLiquidation;
  if (liquidationTotal > 0) {
    const dominant = Math.max(longLiquidation, shortLiquidation);
    const other = Math.min(longLiquidation, shortLiquidation);
    if (dominant >= Math.max(1, other * 1.25)) {
      score += shortLiquidation > longLiquidation ? 1 : -1;
      components++;
      reasons.push(
        `${shortLiquidation > longLiquidation ? "Short" : "Long"} liquidations dominate recent M5 buckets`,
      );
    }
  }
  const direction: Direction =
    components < 2 ? "NONE" : score >= 2 ? "BUY" : score <= -2 ? "SELL" : "NONE";
  if (!reasons.length)
    reasons.push("Derivatives: insufficient fresh positioning data for a directional edge");
  else if (direction === "NONE")
    reasons.push("Derivatives: signals are mixed or below the deterministic threshold");
  return {
    direction,
    strength:
      direction === "NONE"
        ? 0
        : Math.min(100, Math.round(45 + Math.abs(score) * 15 + components * 2)),
    reasons,
    payload: {
      score,
      components,
      price_change_pct: priceChangePct,
      open_interest_change_pct: oiChangePct,
      funding_rate: fundingRate,
      long_short_ratio: longShortRatio,
      long_liquidation_usd: longLiquidation,
      short_liquidation_usd: shortLiquidation,
      sources: [...new Set([
        ...openInterest,
        ...funding,
        ...positioning,
        ...liquidations,
      ].map((row) => row.source))],
    },
  };
}
export function analyzeGroups(
  context: MarketContext,
  scanners: ScannerOutput[],
  config: TradingConfig,
  version: string,
  now = Date.now(),
  derivatives?: DerivativesContext,
): GroupSnapshot[] {
  const byName = Object.fromEntries(scanners.map((s) => [s.name, s])) as Record<
    ScannerOutput["name"],
    ScannerOutput
  >;
  const smcScanners = [byName.structure, byName.liquidity];
  const indicatorScanners = [
    byName.trend,
    byName.momentum,
    byName["mean-reversion"],
  ];
  const smcDirection = directionalWinner(smcScanners.map((s) => s.direction));
  const indicatorDirection = directionalWinner(
    indicatorScanners.map((s) => s.direction),
  );
  const fast = indicators(context.M5, config);
  const recent = context.M5.slice(-6);
  const previousVolume =
    mean(recent.slice(0, -1).map((c) => c.volume)) || 1;
  const volumeExpansion = context.M5.at(-1)!.volume / previousVolume;
  const volumeDirection: Direction =
    volumeExpansion >= config.scanner.volumeRatio &&
    fast.body > 0 &&
    fast.roc > 0
      ? "BUY"
      : volumeExpansion >= config.scanner.volumeRatio &&
          fast.body < 0 &&
          fast.roc < 0
        ? "SELL"
        : "NONE";
  const derivative = analyzeDerivatives(context, derivatives);
  const common = {
    timestamp: now,
    candle_timestamp: context.M5.at(-1)!.timestamp,
    config_version: version,
  };
  return [
    {
      group: "SMC_ICT",
      direction: smcDirection,
      strength: groupStrength(smcScanners, smcDirection),
      reasons: smcScanners.flatMap((s) => s.reasons),
      payload: {
        structure: {
          direction: byName.structure.direction,
          levels: byName.structure.levels,
          detail: byName.structure.indicators.M5,
        },
        liquidity: {
          direction: byName.liquidity.direction,
          levels: byName.liquidity.levels,
          detail: byName.liquidity.indicators.M5,
        },
      },
      ...common,
    },
    {
      group: "INDICATORS",
      direction: indicatorDirection,
      strength: groupStrength(indicatorScanners, indicatorDirection),
      reasons: indicatorScanners.flatMap((s) => s.reasons),
      payload: {
        trend: byName.trend.direction,
        momentum: byName.momentum.direction,
        mean_reversion: byName["mean-reversion"].direction,
        H1: byName.trend.indicators.H1,
        M15: byName.trend.indicators.M15,
        M5: byName.trend.indicators.M5,
      },
      ...common,
    },
    {
      group: "VOLUME",
      direction: volumeDirection,
      strength:
        volumeDirection === "NONE"
          ? 0
          : Math.min(100, Math.round(50 + Math.min(50, (volumeExpansion - 1) * 50))),
      reasons: [
        volumeDirection === "NONE"
          ? "Volume: expansion and directional price confirmation not aligned"
          : `Volume: ${volumeDirection} confirmed by M5 volume expansion, body and ROC`,
      ],
      payload: {
        // Keep the legacy top-level volume keys for audit/API compatibility.
        volume_ratio: fast.volumeRatio,
        recent_volume_ratio: volumeExpansion,
        body: fast.body,
        roc: fast.roc,
        price: fast.price,
        volume: {
          direction: volumeDirection,
          volume_ratio: fast.volumeRatio,
          recent_volume_ratio: volumeExpansion,
          body: fast.body,
          roc: fast.roc,
          price: fast.price,
        },
        breakout: {
          direction: byName.breakout.direction,
          levels: byName.breakout.levels,
          reasons: byName.breakout.reasons,
          detail: byName.breakout.indicators.M5,
        },
        quant: {
          mean_reversion: byName["mean-reversion"].direction,
          bollinger: fast.bb,
          rsi: fast.rsi,
          atr: fast.atr,
          roc: fast.roc,
          price: fast.price,
        },
      },
      ...common,
    },
    {
      group: "DERIVATIVES_POSITIONING",
      ...derivative,
      ...common,
    },
  ];
}
export function groupComposition(groups: GroupSnapshot[]) {
  return groups.reduce(
    (a, group) => {
      a[group.direction]++;
      return a;
    },
    { BUY: 0, SELL: 0, NONE: 0 },
  );
}
export function groupTrigger(
  groups: GroupSnapshot[],
  minimum = defaultConfig.scannerConsensusMin,
): TradeDirection | null {
  const c = groupComposition(groups);
  return c.BUY >= minimum && c.BUY > c.SELL
    ? "BUY"
    : c.SELL >= minimum && c.SELL > c.BUY
      ? "SELL"
      : null;
}
export function fallbackDirection(
  groups: GroupSnapshot[],
  context: MarketContext,
): TradeDirection {
  const score = (direction: TradeDirection) =>
    groups
      .filter((group) => group.direction === direction)
      .reduce((sum, group) => sum + Math.max(1, group.strength), 0);
  const buy = score("BUY");
  const sell = score("SELL");
  if (buy !== sell) return buy > sell ? "BUY" : "SELL";
  const last = context.M5.at(-1)!;
  return last.close >= last.open ? "BUY" : "SELL";
}
export function analystGroup(id: CharacterId): AnalysisGroup | null {
  if (id === "structure" || id === "liquidity") return "SMC_ICT";
  if (id === "trend" || id === "momentum") return "INDICATORS";
  if (id === "volume" || id === "quant") return "VOLUME";
  if (id === "derivatives" || id === "positioning")
    return "DERIVATIVES_POSITIONING";
  return null;
}
export function buildGroupContext(
  context: MarketContext,
  group: GroupSnapshot,
  config: TradingConfig,
  analyst?: CharacterId,
) {
  const candles = {
    H1: context.H1.slice(-Math.min(config.context.H1, 12)),
    M15: context.M15.slice(-Math.min(config.context.M15, 24)),
    M5: context.M5.slice(-Math.min(config.context.M5, 36)),
  };
  const specialistEvidence =
    analyst === "volume" && group.group === "VOLUME"
      ? {
          volume: group.payload.volume,
          breakout: group.payload.breakout,
        }
      : analyst === "quant" && group.group === "VOLUME"
        ? { quant: group.payload.quant }
        : group.payload;
  return {
    market: MARKET,
    specialization: group.group,
    analyst,
    deterministic_snapshot: group,
    specialist_evidence: specialistEvidence,
    recent_candles: candles,
  };
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
  for (const r of results) {
    // Defense in depth: only fully successful, semantically valid outputs vote.
    if (
      r.status !== "SUCCESS" ||
      !r.output ||
      r.flags.includes("SEMANTIC_VALIDATION_FAILED")
    ) {
      counts.UNAVAILABLE++;
      continue;
    }
    counts[r.output.vote]++;
  }
  const expected = Math.max(1, results.length);
  const success = counts.BUY + counts.SELL + counts.NO_TRADE;
  const minimumSuccess = Math.ceil(expected / 2);
  const directional = counts.BUY + counts.SELL;
  // NO_TRADE is an abstention, but a lone directional vote must not decide an
  // eight-analyst case. Two directional votes is the minimum quorum; this
  // preserves the documented plurality rule once real directional participation exists.
  const directionalQuorum = Math.min(2, expected);
  const degraded = success < minimumSuccess;
  const tie =
    !degraded &&
    directional >= directionalQuorum &&
    counts.BUY === counts.SELL &&
    counts.BUY > 0;
  let direction: TradeDirection | null = null;
  const flags: string[] = [];
  if (degraded) {
    direction = scanner;
    flags.push("AI_DEGRADED", "SCANNER_FALLBACK");
  } else if (directional < directionalQuorum) {
    direction = scanner;
    flags.push("AI_ABSTENTION_FALLBACK");
    if (scanner) flags.push("SCANNER_FALLBACK");
  } else if (counts.BUY > counts.SELL) direction = "BUY";
  else if (counts.SELL > counts.BUY) direction = "SELL";
  else if (boss !== "NO_TRADE") direction = boss;
  else {
    direction = scanner;
    if (scanner) flags.push("SCANNER_FALLBACK");
  }
  return {
    direction,
    counts,
    flags,
    degraded,
    tie,
  };
}
export function confidence(
  direction: TradeDirection,
  groups: GroupSnapshot[],
  analysts: AnalystResult[],
  mtf: Direction[],
  config: TradingConfig,
) {
  if (!groups.length || !analysts.length || mtf.length !== 3)
    throw new Error("Confidence requires groups, analysts and 3 timeframes");
  const groupConsensus =
      (groups.filter((s) => s.direction === direction).length / groups.length) *
      100,
    ai =
      (analysts.filter(
        (a) => a.status === "SUCCESS" && a.output?.vote === direction,
      ).length /
        analysts.length) *
      100;
  const alignment = mtf.reduce(
    (sum, d, i) =>
      sum +
      ((d === direction ? 100 : d === "NONE" ? config.neutralScore : 0) *
        config.mtfWeights[i]) /
        100,
    0,
  );
  return {
    groupConsensus,
    // Backward-compatible alias. New consumers should use groupConsensus.
    scanner: groupConsensus,
    ai,
    mtf: alignment,
    total:
      (groupConsensus * config.confidenceWeights[0] +
        ai * config.confidenceWeights[1] +
        alignment * config.confidenceWeights[2]) /
      100,
  };
}
export function risk(
  direction: TradeDirection,
  context: MarketContext,
  config: TradingConfig,
  tickSize = 0.01,
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
  // Expand the entry band and stop away from entry; targets round towards
  // entry, never beyond the structural target to meet a minimum R:R.
  const normalized = {
    entry_low: tickPrice(low, tickSize, "floor"),
    entry_high: tickPrice(high, tickSize, "ceil"),
    preferred_entry: tickPrice(entry, tickSize, "round"),
    stop_loss: tickPrice(
      stop,
      tickSize,
      direction === "BUY" ? "floor" : "ceil",
    ),
    take_profit: tickPrice(
      tp,
      tickSize,
      direction === "BUY" ? "floor" : "ceil",
    ),
  };
  const rr =
    Math.abs(normalized.take_profit - normalized.preferred_entry) /
    Math.abs(normalized.preferred_entry - normalized.stop_loss);
  if (
    !Object.values(normalized).every(
      (price) => Number.isFinite(price) && price > 0,
    ) ||
    normalized.entry_low > normalized.preferred_entry ||
    normalized.preferred_entry > normalized.entry_high ||
    (direction === "BUY"
      ? normalized.stop_loss >= normalized.entry_low ||
        normalized.take_profit <= normalized.entry_high
      : normalized.take_profit >= normalized.entry_low ||
        normalized.stop_loss <= normalized.entry_high) ||
    !Number.isFinite(rr) ||
    rr <= 0
  )
    throw new Error(
      "Invalid positive, ordered risk levels after tick normalization",
    );
  return {
    ...normalized,
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
function tickPrice(
  price: number,
  tick: number,
  rounding: "floor" | "ceil" | "round",
) {
  if (!Number.isFinite(price) || !Number.isFinite(tick) || tick <= 0)
    throw new Error("Invalid price or tick size");
  const [mantissa, exponent = "0"] = tick.toString().split("e");
  const decimals = Math.max(
    0,
    (mantissa.split(".")[1]?.length ?? 0) - Number(exponent),
  );
  if (decimals > 15) throw new Error("Tick precision is not supported");
  const units = price / tick;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(units)) * 4;
  if (tolerance >= 0.01) throw new Error("Price exceeds safe tick precision");
  const ticks =
    rounding === "floor"
      ? Math.floor(units + tolerance)
      : rounding === "ceil"
        ? Math.ceil(units - tolerance)
        : Math.round(units);
  if (!Number.isSafeInteger(ticks))
    throw new Error("Price exceeds safe tick precision");
  return Number((ticks * tick).toFixed(decimals));
}
export function semanticErrors(output: AnalystResult["output"]) {
  if (!output) return ["No structured output"];
  if (output.vote === "NO_TRADE") return [];
  const opposing = output.vote === "BUY" ? "SELL" : "BUY";
  const directional = output.evidence.filter(
    (e) => e.code === "DIRECTIONAL_BIAS",
  );
  const errors: string[] = [];
  if (!directional.some((e) => e.direction === output.vote))
    errors.push(
      "Directional BUY/SELL vote requires matching DIRECTIONAL_BIAS evidence",
    );
  if (directional.some((e) => e.direction === opposing))
    errors.push("Vote contradicts explicit directional bias evidence");
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
