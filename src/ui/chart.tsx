import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  TickMarkType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { candleDuration } from "../core/chart";
import {
  MARKET,
  formatPrice,
  formatWib,
  type Candle,
  type Timeframe,
} from "../core/contracts";
import { useChartData } from "./chart-data";
import { Badge, Empty, Heading, Notice } from "./shared";

const up = "#70d5ba",
  down = "#e99384";
const wibTime = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const wibDay = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  day: "2-digit",
  month: "short",
});
const time = (candle: Candle) => (candle.timestamp / 1000) as UTCTimestamp;
const candlePoint = (candle: Candle) => ({
  time: time(candle),
  open: candle.open,
  high: candle.high,
  low: candle.low,
  close: candle.close,
});
const volumePoint = (candle: Candle) => ({
  time: time(candle),
  value: candle.volume,
  color: candle.close >= candle.open ? "#70d5ba88" : "#e9938488",
});

function CandleChart({
  candles,
  tickSize,
}: {
  candles: Candle[];
  tickSize: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const price = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const previous = useRef<Candle[]>([]);
  const [failure, setFailure] = useState<string>();
  useEffect(() => {
    if (!container.current) return;
    let instance: IChartApi | undefined;
    let observer: ResizeObserver | undefined;
    try {
      instance = createChart(container.current, {
        width: container.current.clientWidth,
        height: container.current.clientHeight,
        layout: {
          background: { type: ColorType.Solid, color: "#141d20" },
          textColor: "#aebcbe",
          attributionLogo: true,
          fontFamily: "system-ui, sans-serif",
          fontSize: 11,
        },
        grid: {
          vertLines: { color: "#253135" },
          horzLines: { color: "#253135" },
        },
        rightPriceScale: { borderColor: "#344246" },
        timeScale: {
          borderColor: "#344246",
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 5,
          shiftVisibleRangeOnNewBar: true,
          tickMarkFormatter: (value: number, kind: TickMarkType) =>
            (kind === TickMarkType.Time || kind === TickMarkType.TimeWithSeconds
              ? wibTime
              : wibDay
            ).format(value * 1000),
        },
        localization: {
          locale: "id-ID",
          timeFormatter: (value: number) => formatWib(value * 1000),
        },
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: false,
        },
        handleScale: {
          mouseWheel: true,
          pinch: true,
          axisPressedMouseMove: true,
        },
      });
      chart.current = instance;
      price.current = instance.addSeries(CandlestickSeries, {
        upColor: up,
        downColor: down,
        borderVisible: false,
        wickUpColor: up,
        wickDownColor: down,
      });
      volume.current = instance.addSeries(
        HistogramSeries,
        {
          priceFormat: { type: "volume" },
          lastValueVisible: false,
          priceLineVisible: false,
        },
        1,
      );
      instance.panes()[0].setStretchFactor(4);
      instance.panes()[1].setStretchFactor(1);
      observer = new ResizeObserver((entries) => {
        const { width, height } = entries[0].contentRect;
        if (width > 0 && height > 0)
          instance?.resize(Math.floor(width), Math.floor(height));
      });
      observer.observe(container.current);
    } catch {
      instance?.remove();
      chart.current = null;
      price.current = null;
      volume.current = null;
      setFailure(
        "Chart tidak dapat ditampilkan pada browser ini. Harga terakhir tetap tersedia di atas.",
      );
    }
    return () => {
      observer?.disconnect();
      if (chart.current === instance) instance?.remove();
      chart.current = null;
      price.current = null;
      volume.current = null;
      previous.current = [];
    };
  }, []);
  useEffect(() => {
    if (!price.current) return;
    // Also supports non-decimal tick sizes such as 0.25 or 0.0005.
    let precision = 0;
    while (
      precision < 10 &&
      Math.abs(
        tickSize * 10 ** precision - Math.round(tickSize * 10 ** precision),
      ) > 1e-8
    )
      precision++;
    price.current.applyOptions({
      priceFormat: { type: "price", precision, minMove: tickSize },
    });
  }, [tickSize]);
  useEffect(() => {
    if (!chart.current || !price.current || !volume.current) return;
    const old = previous.current;
    const append =
      old.length > 0 &&
      old.length <= candles.length &&
      old.every((candle, index) =>
        (Object.keys(candle) as (keyof Candle)[]).every(
          (key) => candle[key] === candles[index][key],
        ),
      );
    if (append) {
      for (const candle of candles.slice(old.length)) {
        price.current.update(candlePoint(candle));
        volume.current.update(volumePoint(candle));
      }
    } else {
      const range = old.length
        ? chart.current.timeScale().getVisibleRange()
        : null;
      price.current.setData(candles.map(candlePoint));
      volume.current.setData(candles.map(volumePoint));
      const overlaps =
        range &&
        candles.length &&
        typeof range.from === "number" &&
        typeof range.to === "number" &&
        range.to >= time(candles[0]) &&
        range.from <= time(candles.at(-1)!);
      if (overlaps) chart.current.timeScale().setVisibleRange(range);
      else if (candles.length) {
        const visibleBars = Math.max(
          40,
          Math.min(
            120,
            Math.floor(((container.current?.clientWidth ?? 800) - 80) / 6),
          ),
        );
        chart.current.timeScale().setVisibleLogicalRange({
          from: Math.max(0, candles.length - visibleBars),
          to: candles.length + 5,
        });
      }
    }
    previous.current = candles;
  }, [candles]);
  return (
    <>
      <div
        className="chart-canvas"
        ref={container}
        role="img"
        aria-label="Grafik candlestick dan volume BTCUSDT, waktu WIB"
      />
      <Notice error={failure} />
      <div className="chart-footer">
        <span>
          Geser untuk riwayat · scroll atau cubit untuk zoom · waktu WIB
        </span>
        <button
          onClick={() => chart.current?.timeScale().scrollToRealTime()}
          disabled={!!failure}
        >
          Ke candle terbaru
        </button>
      </div>
      <small className="chart-attribution">
        TradingView Lightweight Charts™ · Copyright (с) 2025 TradingView, Inc.{" "}
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          TradingView
        </a>
      </small>
    </>
  );
}

export default function ChartPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("timeframe");
  const timeframe: Timeframe = raw === "M15" || raw === "H1" ? raw : "M5";
  return (
    <section className="chart-page">
      <Heading
        eyebrow="MARKET / BTCUSDT"
        title="Chart"
        description="Candlestick dan volume · candle yang sudah ditutup · tanpa indikator"
      />
      <div className="chart-toolbar">
        <strong>{MARKET}</strong>
        <div
          role="group"
          aria-label="Timeframe chart"
          className="chart-timeframes"
        >
          {(["M5", "M15", "H1"] as const).map((value) => (
            <button
              key={value}
              aria-pressed={timeframe === value}
              onClick={() => setParams({ timeframe: value })}
            >
              {value}
            </button>
          ))}
        </div>
      </div>
      <ChartPanel key={timeframe} timeframe={timeframe} />
    </section>
  );
}

function ChartPanel({ timeframe }: { timeframe: Timeframe }) {
  const { data, error, loading, retry } = useChartData(timeframe);
  const latest = data?.candles.at(-1);
  const gaps = data?.candles.some(
    (candle, index, candles) =>
      index > 0 &&
      candle.timestamp - candles[index - 1].timestamp !==
        candleDuration[timeframe],
  );
  return (
    <>
      <Notice error={error} retry={retry} />
      {loading && <Empty>Memuat candle {timeframe}…</Empty>}
      {data && (
        <>
          <div className="chart-summary" aria-label="Ringkasan candle terakhir">
            <div>
              <span>Harga penutupan</span>
              <strong>
                {latest ? formatPrice(latest.close, data.tickSize) : "—"}
              </strong>
            </div>
            {latest && (
              <div className="chart-ohlc">
                <span>O {formatPrice(latest.open, data.tickSize)}</span>
                <span>H {formatPrice(latest.high, data.tickSize)}</span>
                <span>L {formatPrice(latest.low, data.tickSize)}</span>
                <span>
                  V{" "}
                  {latest.volume.toLocaleString("id-ID", {
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            )}
            <Badge value={error ? "UNKNOWN" : data.status} />
          </div>
          {data.development && (
            <div className="notice" role="status">
              Lingkungan pengembangan · data dapat berasal dari fixture lokal.
            </div>
          )}
          {data.status === "STALE" && (
            <div className="notice" role="status">
              Data candle terlambat. Grafik menampilkan riwayat terakhir yang
              tersedia.
            </div>
          )}
          {gaps && (
            <div className="notice" role="status">
              Ada jeda pada riwayat candle. Data yang kosong tidak diisi dengan
              harga buatan.
            </div>
          )}
          {!latest ? (
            <Empty>Belum ada candle {timeframe} yang tersedia.</Empty>
          ) : (
            <div className="chart-card">
              <CandleChart candles={data.candles} tickSize={data.tickSize} />
            </div>
          )}
          <p className="chart-caption">
            {data.candles.length} candle
            {latest ? ` · Terakhir ${formatWib(latest.timestamp)}` : ""} ·
            Pembaruan setiap 30 detik saat halaman aktif. Harga candle berjalan
            belum ditampilkan.
          </p>
        </>
      )}
    </>
  );
}
