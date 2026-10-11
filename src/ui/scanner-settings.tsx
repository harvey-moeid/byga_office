import type { TradingConfig } from "../core/contracts";

type ScannerConfig = TradingConfig["scanner"];
const fields = [
  {
    key: "ema",
    index: 0,
    label: "EMA cepat",
    min: 2,
    max: 500,
    step: 1,
    help: "Jumlah candle EMA cepat; harus lebih kecil daripada EMA menengah.",
  },
  {
    key: "ema",
    index: 1,
    label: "EMA menengah",
    min: 2,
    max: 500,
    step: 1,
    help: "Jumlah candle EMA menengah; berada di antara EMA cepat dan lambat.",
  },
  {
    key: "ema",
    index: 2,
    label: "EMA lambat",
    min: 2,
    max: 500,
    step: 1,
    help: "Jumlah candle EMA lambat untuk konteks tren yang lebih panjang.",
  },
  {
    key: "period",
    label: "Periode indikator",
    min: 2,
    max: 100,
    step: 1,
    help: "Jumlah candle untuk perhitungan indikator scanner.",
  },
  {
    key: "adxMin",
    label: "ADX minimum",
    min: 0,
    max: 100,
    step: 1,
    help: "Ambang kekuatan tren. Nilai lebih tinggi meminta tren yang lebih kuat.",
  },
  {
    key: "volumeRatio",
    label: "Rasio volume minimum",
    min: 0.01,
    max: 10,
    step: 0.05,
    help: "Volume dibanding rata-rata; 1 berarti setara rata-rata.",
  },
  {
    key: "momentumRsi",
    index: 0,
    label: "RSI momentum BUY",
    min: 0,
    max: 100,
    step: 1,
    help: "Ambang RSI momentum naik; wajib lebih tinggi daripada ambang SELL.",
  },
  {
    key: "momentumRsi",
    index: 1,
    label: "RSI momentum SELL",
    min: 0,
    max: 100,
    step: 1,
    help: "Ambang RSI momentum turun; wajib lebih rendah daripada ambang BUY.",
  },
  {
    key: "reversionRsi",
    index: 0,
    label: "RSI reversion oversold",
    min: 0,
    max: 100,
    step: 1,
    help: "Batas RSI rendah untuk mencari pembalikan BUY; di bawah batas overbought.",
  },
  {
    key: "reversionRsi",
    index: 1,
    label: "RSI reversion overbought",
    min: 0,
    max: 100,
    step: 1,
    help: "Batas RSI tinggi untuk mencari pembalikan SELL; di atas batas oversold.",
  },
  {
    key: "bbDeviation",
    label: "Deviasi Bollinger Band",
    min: 0.01,
    max: 5,
    step: 0.1,
    help: "Pengali deviasi standar untuk lebar Bollinger Band.",
  },
  {
    key: "structureWindow",
    label: "Jendela struktur",
    min: 5,
    max: 200,
    step: 1,
    help: "Jumlah candle untuk mencari struktur harga dan breakout.",
  },
  {
    key: "displacementAtr",
    label: "Displacement ATR",
    min: 0.01,
    max: 10,
    step: 0.05,
    help: "Ukuran gerakan harga minimum sebagai kelipatan ATR.",
  },
] as const;

export function ScannerSettings({
  value,
  onChange,
}: {
  value: ScannerConfig;
  onChange: (value: ScannerConfig) => void;
}) {
  return (
    <fieldset className="scanner-settings">
      <legend>Parameter scanner</legend>
      <p className="muted">
        Scanner memakai aturan deterministik. Perubahan parameter berlaku sesuai
        pilihan Activation saat versi konfigurasi disimpan.
      </p>
      <div className="form-grid">
        {fields.map((field) => {
          const index = "index" in field ? field.index : undefined;
          const current = value[field.key];
          const numeric = Array.isArray(current) ? current[index!] : current;
          const id = `scanner-${field.key}-${index ?? "value"}`;
          return (
            <label key={id} htmlFor={id}>
              {field.label}
              <input
                id={id}
                aria-label={field.label}
                type="number"
                value={Number.isFinite(numeric) ? numeric : ""}
                min={field.min}
                max={field.max}
                step={field.step}
                required
                aria-describedby={`${id}-help`}
                onChange={(event) => {
                  const number =
                    event.target.value === ""
                      ? NaN
                      : Number(event.target.value);
                  const next = Array.isArray(current)
                    ? current.map((n, i) => (i === index ? number : n))
                    : number;
                  onChange({ ...value, [field.key]: next });
                }}
              />
              <small id={`${id}-help`} className="muted">
                {field.help}
              </small>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
