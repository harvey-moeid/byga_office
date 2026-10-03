import type { Candle } from "./contracts";
export const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
export function ema(values: number[], period: number) {
  if (values.length < period) throw new Error(`Need ${period} candles for EMA`);
  let value = mean(values.slice(0, period));
  const out = values.slice(0, period - 1).map(() => NaN);
  out.push(value);
  for (const v of values.slice(period)) {
    value += ((v - value) * 2) / (period + 1);
    out.push(value);
  }
  return out;
}
function wilder(values: number[], period: number) {
  if (values.length < period) throw new Error("Insufficient indicator history");
  let v = mean(values.slice(0, period));
  const out = [v];
  for (const x of values.slice(period)) {
    v = (v * (period - 1) + x) / period;
    out.push(v);
  }
  return out;
}
export function atr(c: Candle[], period = 14) {
  return wilder(
    c
      .slice(1)
      .map((x, i) =>
        Math.max(
          x.high - x.low,
          Math.abs(x.high - c[i].close),
          Math.abs(x.low - c[i].close),
        ),
      ),
    period,
  ).at(-1)!;
}
export function rsi(values: number[], period = 14) {
  const changes = values.slice(1).map((v, i) => v - values[i]);
  const gain = wilder(
    changes.map((v) => Math.max(0, v)),
    period,
  ).at(-1)!;
  const loss = wilder(
    changes.map((v) => Math.max(0, -v)),
    period,
  ).at(-1)!;
  return loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
}
export function adx(c: Candle[], period = 14) {
  const tr: number[] = [],
    plus: number[] = [],
    minus: number[] = [];
  for (let i = 1; i < c.length; i++) {
    const up = c[i].high - c[i - 1].high,
      down = c[i - 1].low - c[i].low;
    plus.push(up > down && up > 0 ? up : 0);
    minus.push(down > up && down > 0 ? down : 0);
    tr.push(
      Math.max(
        c[i].high - c[i].low,
        Math.abs(c[i].high - c[i - 1].close),
        Math.abs(c[i].low - c[i - 1].close),
      ),
    );
  }
  const t = wilder(tr, period),
    p = wilder(plus, period),
    m = wilder(minus, period);
  const dx = t.map((v, i) => {
    const pd = v ? (100 * p[i]) / v : 0,
      md = v ? (100 * m[i]) / v : 0;
    return pd + md ? (100 * Math.abs(pd - md)) / (pd + md) : 0;
  });
  return wilder(dx, period).at(-1)!;
}
export function macd(values: number[]) {
  const fast = ema(values, 12),
    slow = ema(values, 26);
  const line = values.slice(25).map((_, i) => fast[i + 25] - slow[i + 25]);
  const signal = ema(line, 9).at(-1)!;
  return { line: line.at(-1)!, signal, histogram: line.at(-1)! - signal };
}
export function bollinger(values: number[], period = 20, deviation = 2) {
  const s = values.slice(-period);
  if (s.length < period) throw new Error("Insufficient Bollinger history");
  const mid = mean(s),
    sd = Math.sqrt(mean(s.map((v) => (v - mid) ** 2)));
  return {
    mid,
    upper: mid + deviation * sd,
    lower: mid - deviation * sd,
    deviation: sd,
  };
}
export function roc(values: number[], period = 10) {
  return (values.at(-1)! / values.at(-period - 1)! - 1) * 100;
}
export function structure(c: Candle[], window = 20) {
  const highs: number[] = [],
    lows: number[] = [];
  for (let i = 2; i < c.length - 2; i++) {
    if (
      c[i].high >
      Math.max(c[i - 2].high, c[i - 1].high, c[i + 1].high, c[i + 2].high)
    )
      highs.push(c[i].high);
    if (
      c[i].low <
      Math.min(c[i - 2].low, c[i - 1].low, c[i + 1].low, c[i + 2].low)
    )
      lows.push(c[i].low);
  }
  const prior = c.slice(-window - 1, -1);
  const resistance = Math.max(...prior.map((x) => x.high)),
    support = Math.min(...prior.map((x) => x.low));
  const last = c.at(-1)!,
    prev = c.at(-2)!;
  const hh = highs.length >= 2 && highs.at(-1)! > highs.at(-2)!,
    hl = lows.length >= 2 && lows.at(-1)! > lows.at(-2)!,
    lh = highs.length >= 2 && highs.at(-1)! < highs.at(-2)!,
    ll = lows.length >= 2 && lows.at(-1)! < lows.at(-2)!;
  const bias = hh && hl ? "BUY" : lh && ll ? "SELL" : "NONE";
  const breakout =
    last.close > resistance ? "BUY" : last.close < support ? "SELL" : "NONE";
  const sweep =
    last.low < support && last.close > support
      ? "BUY"
      : last.high > resistance && last.close < resistance
        ? "SELL"
        : "NONE";
  const fvg =
    c.length >= 3
      ? last.low > c.at(-3)!.high
        ? "BUY"
        : last.high < c.at(-3)!.low
          ? "SELL"
          : "NONE"
      : "NONE";
  const bos =
    highs.length && last.close > highs.at(-1)!
      ? "BUY"
      : lows.length && last.close < lows.at(-1)!
        ? "SELL"
        : "NONE";
  const choch =
    bias === "BUY" && bos === "SELL"
      ? "SELL"
      : bias === "SELL" && bos === "BUY"
        ? "BUY"
        : "NONE";
  const beforeBreakout = c.slice(-window - 2, -2);
  const retestResistance = Math.max(...beforeBreakout.map((x) => x.high));
  const retestSupport = Math.min(...beforeBreakout.map((x) => x.low));
  const retest =
    last.low <= retestResistance &&
    last.close > retestResistance &&
    prev.close > retestResistance
      ? "BUY"
      : last.high >= retestSupport &&
          last.close < retestSupport &&
          prev.close < retestSupport
        ? "SELL"
        : "NONE";
  const displacement =
    breakout !== "NONE" ? breakout : fvg !== "NONE" ? fvg : sweep;
  const orderBlock = c
    .slice(-window)
    .reverse()
    .find((x) =>
      displacement === "BUY"
        ? x.close < x.open
        : displacement === "SELL"
          ? x.close > x.open
          : false,
    );
  return {
    highs: highs.slice(-10),
    lows: lows.slice(-10),
    support,
    resistance,
    hh,
    hl,
    lh,
    ll,
    bias,
    breakout,
    sweep,
    fvg,
    bos,
    choch,
    retest,
    retestResistance,
    retestSupport,
    orderBlock: orderBlock
      ? { low: orderBlock.low, high: orderBlock.high }
      : null,
  } as const;
}
