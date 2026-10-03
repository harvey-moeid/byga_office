import React, { Component, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  characterIds,
  defaultConfig,
  formatPrice,
  formatWib,
  providers,
  scannerNames,
  type CharacterConfig,
  type ScannerOutput,
  type Signal,
  type TradingConfig,
} from "../core/contracts";
import "./style.css";
import { api, useData, useOnline } from "./data";
const OfficeScene = lazy(() => import("./scene"));
interface OfficeState {
  office: string;
  active: { id: string; status: string } | null;
  scanners: ScannerOutput[];
  last_processed_candle?: number;
  error?: string;
}
interface Market {
  development?: boolean;
  price: number;
  tickSize: number;
  candle_timestamp: number;
  timeframes: Record<string, { close: number; timestamp: number }[]>;
}
interface PublicCase {
  id: string;
  status: string;
  direction: string | null;
  created_at: number;
  updated_at: number;
  source: string;
  signal?: Signal;
  analysts: {
    id: string;
    status: string;
    vote?: string;
    confidence?: number;
    summary?: string;
    warning?: string;
    output?: { vote: string; summary: string };
  }[];
}
const roles: Record<string, string> = {
  trend: "Trend Analyst",
  structure: "Structure Analyst",
  momentum: "Momentum Analyst",
  liquidity: "Liquidity Analyst",
  volume: "Volume Analyst",
  quant: "Quant Analyst",
  risk: "Risk Manager",
  boss: "Head Trader",
};
function Badge({ value }: { value: string }) {
  return (
    <span
      className={`badge ${value === "BUY" || value === "OK" || value === "CLOSED" ? "positive" : value === "SELL" || value === "DOWN" || value === "FAILED" ? "negative" : ""}`}
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}
function Notice({ error, retry }: { error?: string; retry?: () => void }) {
  return error ? (
    <div role="alert" className="notice">
      {error}
      {retry && <button onClick={retry}>Coba lagi</button>}
    </div>
  ) : null;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}
function App() {
  const session = useData<{ admin: boolean }>("/auth/session");
  const online = useOnline();
  return (
    <BrowserRouter>
      <div className="shell">
        {!online && (
          <div className="connection-banner" role="status">
            Offline · Data terakhir belum diperbarui. Akan tersambung ulang
            otomatis.
          </div>
        )}
        <aside className="sidebar">
          <Link to="/office" className="brand">
            <b>
              BG<span> / </span>
            </b>
            <div>
              BYGA<small>AI TRADING OFFICE</small>
            </div>
          </Link>
          <span className="nav-label">OPERATIONS</span>
          <nav>
            {[
              ["/office", "◈", "Trading Office"],
              ["/scanners", "▦", "Scanners"],
              ["/signals", "↗", "Signals"],
              ["/cases", "▤", "Cases"],
              ["/characters", "◎", "AI Team"],
              ["/simulation", "▷", "Simulation"],
              ["/admin", "⚙", "Admin"],
            ].map(([path, icon, title]) => (
              <NavLink key={path} to={path}>
                <span>{icon}</span>
                {title}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <span className="dot" /> BTCUSDT ONLY
            <small>Asia/Jakarta · WIB</small>
          </div>
        </aside>
        <main>
          <header className="topbar">
            <span>
              BYGA / OPERATIONS <i>●</i>
            </span>
            <div>
              <span className="muted">Cloudflare-first</span>
              <Link to="/admin">
                {session.data?.admin ? "Admin terhubung" : "Login Admin"}
              </Link>
            </div>
          </header>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/office" element={<Dashboard />} />
            <Route path="/scanners" element={<Scanners />} />
            <Route path="/scanners/:id" element={<ScannerDetail />} />
            <Route path="/signals" element={<Signals />} />
            <Route path="/signals/:id" element={<SignalDetail />} />
            <Route path="/cases" element={<Cases />} />
            <Route path="/cases/:id" element={<CaseDetail />} />
            <Route path="/characters" element={<Characters />} />
            <Route path="/characters/:id" element={<CharacterDetail />} />
            <Route path="/simulation" element={<Simulation />} />
            <Route path="/simulation/history" element={<SimulationHistory />} />
            <Route path="/simulation/:id" element={<CaseDetail simulation />} />
            <Route
              path="/admin/*"
              element={<Admin onSessionChange={session.retry} />}
            />
            <Route path="*" element={<Empty>Halaman tidak ditemukan.</Empty>} />
          </Routes>
          <footer>
            AI Analysts. Deterministic Systems. One Trading Office.
            <span>Analisis trading · tanpa eksekusi order</span>
          </footer>
        </main>
      </div>
    </BrowserRouter>
  );
}
function Heading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
class SceneBoundary extends Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Empty>3D tidak tersedia. Dashboard operasi tetap dapat digunakan.</Empty>
    ) : (
      this.props.children
    );
  }
}
function supportsWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
function Dashboard() {
  const state = useData<OfficeState>("/office/state", true),
    market = useData<Market>("/market/status", true);
  const [view, setView] = useState("3D");
  const [selected, setSelected] = useState<string>();
  const [prayer, setPrayer] = useState(false);
  const [pendingPrayer, setPendingPrayer] = useState(false);
  const [tf, setTf] = useState("M5");
  const busy = !!state.data?.active;
  useEffect(() => {
    const fallback = () => setView("Operations");
    window.addEventListener("byga:webgl-lost", fallback);
    return () => window.removeEventListener("byga:webgl-lost", fallback);
  }, []);
  useEffect(() => {
    if (pendingPrayer && !busy) {
      setPrayer(true);
      setPendingPrayer(false);
    }
    if (busy) setPrayer(false);
  }, [busy, pendingPrayer]);
  useEffect(() => {
    if (!prayer) return;
    const t = setTimeout(() => setPrayer(false), 16000);
    return () => clearTimeout(t);
  }, [prayer]);
  const office = state.data?.office ?? "CONNECTING";
  const health = useData<Record<string, string>>("/health", true);
  return (
    <>
      <Heading
        eyebrow="LIVE OPERATIONS"
        title="Trading Office"
        description="Enam sistem deterministik. Delapan perspektif AI."
        action={
          <div className="actions">
            <button
              onClick={() => (busy ? setPendingPrayer(true) : setPrayer(true))}
              disabled={prayer || pendingPrayer}
            >
              {pendingPrayer
                ? "Sholat dalam antrean"
                : prayer
                  ? "Menuju Musolla"
                  : "Sholat"}
            </button>
            <Link className="button primary" to="/admin">
              Emergency Meeting ↗
            </Link>
          </div>
        }
      />
      <Notice error={state.error} retry={state.retry} />
      <Notice error={market.error} retry={market.retry} />
      {market.data?.development && (
        <div className="notice">
          Lingkungan pengembangan lokal · candle fixture bukan data pasar
          produksi.
        </div>
      )}
      <div className="metrics">
        <div>
          <span>MARKET</span>
          <strong>
            BTC<span className="muted"> / USDT</span>
          </strong>
          <small>H1 → M15 → M5</small>
        </div>
        <div>
          <span>LAST CLOSED PRICE</span>
          <strong>
            {market.data
              ? formatPrice(market.data.price, market.data.tickSize)
              : "—"}
          </strong>
          <small>
            {market.data
              ? formatWib(market.data.candle_timestamp)
              : "Menunggu data pasar"}
          </small>
        </div>
        <div>
          <span>OFFICE STATE</span>
          <strong>
            <span className="dot" />
            {office.replaceAll("_", " ")}
          </strong>
          <small>
            {busy ? state.data?.active?.id : "Tidak ada meeting aktif"}
          </small>
        </div>
        <div>
          <span>SCANNER CONSENSUS</span>
          <strong>
            {state.data?.scanners.filter((s) => s.direction === "BUY").length ??
              0}
            <em> BUY </em>
            {state.data?.scanners.filter((s) => s.direction === "SELL")
              .length ?? 0}
            <em> SELL</em>
          </strong>
          <small>Minimal 2 · majority unik</small>
        </div>
      </div>
      <section className="office-panel">
        <div className="panel-title">
          <div>
            <span className="dot" /> BYGA / LIVING OFFICE
          </div>
          <div className="segmented">
            {["3D", "Operations"].map((v) => (
              <button
                className={v === view ? "selected" : ""}
                key={v}
                onClick={() => setView(v)}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        {view === "3D" && supportsWebGL() ? (
          <SceneBoundary>
            <Suspense fallback={<Empty>Memuat kantor 3D…</Empty>}>
              <OfficeScene
                state={office}
                prayer={prayer}
                onSelect={setSelected}
                prices={market.data?.timeframes.M5.map((c) => c.close) ?? []}
              />
            </Suspense>
          </SceneBoundary>
        ) : (
          <div className="operations-grid">
            {characterIds.map((id) => (
              <button key={id} onClick={() => setSelected(id)}>
                <span className="avatar">
                  {id === "boss"
                    ? "BG"
                    : roles[id]
                        .split(" ")
                        .map((s) => s[0])
                        .join("")}
                </span>
                <strong>{roles[id]}</strong>
                <Badge value={busy ? "ACTIVE" : "MONITORING"} />
              </button>
            ))}
          </div>
        )}
        <div className="office-caption">
          <span>
            ISOMETRIC VIEW ·{" "}
            {view === "3D" ? "Drag to orbit · pinch to zoom" : "2D dashboard"}
          </span>
          <span>{busy ? "Meeting berjalan" : "Monitoring market"}</span>
        </div>
      </section>
      <div className="two-columns">
        <section className="panel">
          <div className="panel-title">
            <h2>Scanner Command Center</h2>
            <Link to="/scanners">Lihat semua ↗</Link>
          </div>
          <ScannerGrid scanners={state.data?.scanners ?? []} />
        </section>
        <section className="panel">
          <div className="panel-title">
            <h2>Market Wall</h2>
            <div className="segmented">
              {["H1", "M15", "M5"].map((t) => (
                <button
                  key={t}
                  className={tf === t ? "selected" : ""}
                  onClick={() => setTf(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <Chart candles={market.data?.timeframes[tf] ?? []} />
          <p className="muted">Candle tertutup · {tf} · WIB</p>
        </section>
      </div>
      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(undefined)}>
          <section className="modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="close"
              aria-label="Tutup"
              onClick={() => setSelected(undefined)}
            >
              ×
            </button>
            <span className="eyebrow">BYGA AI TEAM</span>
            <h2>
              {selected === "market-wall"
                ? "Market Wall"
                : (roles[selected] ?? selected)}
            </h2>
            {selected === "market-wall" ? (
              <>
                <div className="segmented">
                  {["H1", "M15", "M5"].map((t) => (
                    <button key={t} onClick={() => setTf(t)}>
                      {t}
                    </button>
                  ))}
                </div>
                <Chart candles={market.data?.timeframes[tf] ?? []} />
              </>
            ) : selected === "server-room" ? (
              <>
                <Notice error={health.error} retry={health.retry} />
                {Object.entries(health.data ?? {}).map(([name, status]) => (
                  <p key={name}>
                    {name} <Badge value={status} />
                  </p>
                ))}
                <Link className="button" to="/admin">
                  Provider diagnostics (Admin)
                </Link>
              </>
            ) : (
              <>
                <Badge value={busy ? "ANALYZING" : "MONITORING"} />
                <p>
                  {busy
                    ? "Analisis meeting sedang diproses backend."
                    : "Memantau pasar. Tidak ada panggilan AI saat aktivitas dekoratif."}
                </p>
                <Link className="button primary" to={`/characters/${selected}`}>
                  Lihat Detail ↗
                </Link>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
function Chart({
  candles,
}: {
  candles: { close: number; timestamp: number }[];
}) {
  if (!candles.length) return <Empty>Belum ada candle yang tersedia.</Empty>;
  const prices = candles.map((c) => c.close),
    low = Math.min(...prices),
    high = Math.max(...prices),
    span = high - low || 1;
  return (
    <svg
      className="chart"
      viewBox="0 0 600 200"
      role="img"
      aria-label="Harga penutupan candle"
    >
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#b5dba3" stopOpacity=".25" />
          <stop offset="1" stopColor="#b5dba3" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[30, 80, 130, 180].map((y) => (
        <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="#2b3437" />
      ))}
      <polyline
        fill="none"
        stroke="#b5dba3"
        strokeWidth="2"
        points={prices
          .map(
            (p, i) =>
              `${(i / (prices.length - 1 || 1)) * 600},${180 - ((p - low) / span) * 150}`,
          )
          .join(" ")}
      />
      <text x="8" y="20" fill="#91a0a4" fontSize="12">
        {high.toLocaleString()}
      </text>
      <text x="8" y="198" fill="#91a0a4" fontSize="12">
        {low.toLocaleString()}
      </text>
    </svg>
  );
}
function ScannerGrid({ scanners }: { scanners: ScannerOutput[] }) {
  return (
    <div className="scanner-grid">
      {scannerNames.map((name) => {
        const s = scanners.find((x) => x.name === name);
        return (
          <Link className="scanner-card" to={`/scanners/${name}`} key={name}>
            <div>
              <span className="scanner-icon">▧</span>
              <Badge value={s?.direction ?? "WAITING"} />
            </div>
            <h3>{name.replaceAll("-", " ")}</h3>
            <p>
              {s
                ? `${s.h1_bias} / ${s.m15_setup} / ${s.m5_trigger}`
                : "Menunggu scan pertama"}
            </p>
            <div className="strength">
              <span style={{ width: `${s?.strength ?? 0}%` }} />
            </div>
            <small>Strength {s?.strength ?? "—"} · informational</small>
          </Link>
        );
      })}
    </div>
  );
}
function Scanners() {
  const data = useData<ScannerOutput[]>("/scanners", true);
  return (
    <>
      <Heading
        eyebrow="DETERMINISTIC SYSTEMS"
        title="Scanners"
        description="Semua enam scanner selalu aktif; strength tidak mengubah voting atau confidence."
      />
      <Notice error={data.error} retry={data.retry} />
      <ScannerGrid scanners={data.data ?? []} />
    </>
  );
}
function ScannerDetail() {
  const { id } = useParams();
  const data = useData<ScannerOutput[]>(`/scanners/${id}`, true);
  const s = data.data?.[0];
  return (
    <>
      <Heading eyebrow="SCANNER DETAIL" title={id ?? "Scanner"} />
      <Notice error={data.error} retry={data.retry} />
      {s ? (
        <>
          <section className="panel">
            <Badge value={s.direction} />
            <h2>
              H1 {s.h1_bias} → M15 {s.m15_setup} → M5 {s.m5_trigger}
            </h2>
            <p>{s.reasons.join(" · ")}</p>
            <p>
              {formatWib(s.candle_timestamp)} · {s.config_version}
            </p>
            <h3>Levels</h3>
            <p>{s.levels.map((x) => x.toLocaleString()).join(" / ")}</p>
            <h3>Indicator snapshot</h3>
            <pre>{JSON.stringify(s.indicators, null, 2)}</pre>
          </section>
          <h2>Recent scans</h2>
          {data.data?.map((v, i) => (
            <div className="list-row" key={i}>
              <Badge value={v.direction} />
              <span>{formatWib(v.candle_timestamp)}</span>
              <span>{v.config_version}</span>
            </div>
          ))}
        </>
      ) : (
        <Empty>Belum ada hasil scanner.</Empty>
      )}
    </>
  );
}
function Signals() {
  const [filters, setFilters] = useState({
      direction: "",
      flag: "",
      source: "",
      scanner: "",
      from: "",
      to: "",
      case: "",
      id: "",
      minConfidence: "",
      maxConfidence: "",
    }),
    [page, setPage] = useState(1);
  const query = new URLSearchParams({ ...filters, page: String(page) });
  const data = useData<{ items: Signal[]; total: number; page: number }>(
    `/signals?${query}`,
    true,
  );
  return (
    <>
      <Heading
        eyebrow="LIVE SIGNALS"
        title="Signals"
        description="Snapshot keputusan final. Simulasi dan hasil profit/loss tidak ditampilkan di sini."
      />
      <section className="filters">
        {(["direction", "flag", "source", "scanner"] as const).map((field) => (
          <label key={field}>
            {field}
            <select
              value={filters[field]}
              onChange={(e) => {
                setFilters({ ...filters, [field]: e.target.value });
                setPage(1);
              }}
            >
              <option value="">Semua</option>
              {(field === "direction"
                ? ["BUY", "SELL"]
                : field === "flag"
                  ? ["LOW_RR", "COUNTER_TREND", "AI_DEGRADED"]
                  : field === "scanner"
                    ? [...scannerNames]
                    : ["AUTO", "EMERGENCY"]
              ).map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        ))}
        {(
          [
            "from",
            "to",
            "case",
            "id",
            "minConfidence",
            "maxConfidence",
          ] as const
        ).map((field) => (
          <label key={field}>
            {field}
            <input
              type={
                field === "from" || field === "to"
                  ? "date"
                  : field.includes("Confidence")
                    ? "number"
                    : "text"
              }
              value={filters[field]}
              onChange={(e) => {
                setFilters({ ...filters, [field]: e.target.value });
                setPage(1);
              }}
            />
          </label>
        ))}
      </section>
      <Notice error={data.error} retry={data.retry} />
      {data.loading ? (
        <Empty>Memuat signals…</Empty>
      ) : data.data?.items.length ? (
        <div className="signal-list">
          {data.data.items.map((s) => (
            <Link
              to={`/signals/${s.signal_id}`}
              className="signal-card"
              key={s.signal_id}
            >
              <div>
                <Badge value={s.direction} />
                <span>{s.signal_id}</span>
                <strong>{Math.round(s.confidence)}%</strong>
              </div>
              <h3>BTCUSDT</h3>
              <p>
                Entry {formatPrice(s.entry_low, s.tick_size)} –{" "}
                {formatPrice(s.entry_high, s.tick_size)}
              </p>
              <small>
                SL {formatPrice(s.stop_loss, s.tick_size)} · TP{" "}
                {formatPrice(s.take_profit, s.tick_size)} · R:R 1:
                {s.risk_reward.toFixed(2)}
              </small>
              <p className="warning">{s.flags.join(" · ")}</p>
              <small>{formatWib(s.created_at)}</small>
            </Link>
          ))}
        </div>
      ) : (
        !data.error && <Empty>Belum ada signal live.</Empty>
      )}
      <div className="pagination">
        <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          ← Sebelumnya
        </button>
        <span>
          Halaman {page} · {data.data?.total ?? 0} signals
        </span>
        <button
          disabled={page * 20 >= (data.data?.total ?? 0)}
          onClick={() => setPage((p) => p + 1)}
        >
          Berikutnya →
        </button>
      </div>
    </>
  );
}
function SignalView({ signal: s }: { signal: Signal }) {
  return (
    <section className="panel">
      <div className="panel-title">
        <Badge value={s.direction} />
        <strong className="big-number">{Math.round(s.confidence)}%</strong>
      </div>
      <h2>BTCUSDT · {s.signal_id}</h2>
      <div className="risk-grid">
        {[
          ["Entry Low", s.entry_low],
          ["Entry High", s.entry_high],
          ["Preferred Entry", s.preferred_entry],
          ["Stop Loss", s.stop_loss],
          ["Take Profit", s.take_profit],
          ["Risk:Reward", `1:${s.risk_reward.toFixed(2)}`],
        ].map(([k, v]) => (
          <div key={k}>
            <small>{k}</small>
            <strong>
              {typeof v === "number" ? formatPrice(v, s.tick_size) : v}
            </strong>
          </div>
        ))}
      </div>
      <p className="warning">{s.flags.join(" · ")}</p>
      <p>{s.boss_summary}</p>
      <p>
        Scanners {JSON.stringify(s.scanner_composition)} · AI{" "}
        {JSON.stringify(s.ai_vote_composition)}
      </p>
      <p>
        H1 {s.h1_bias} / M15 {s.m15_setup} / M5 {s.m5_trigger}
      </p>
      <p className="muted">
        {formatWib(s.created_at)} · {s.config_version} · {s.source}
      </p>
      <Link to={`/cases/${s.case_id}`}>Lihat analysis case ↗</Link>
    </section>
  );
}
function SignalDetail() {
  const { id } = useParams();
  const data = useData<Signal>(`/signals/${id}`);
  return (
    <>
      <Heading eyebrow="FINAL DECISION" title={id ?? "Signal"} />
      <Notice error={data.error} retry={data.retry} />
      {data.data && <SignalView signal={data.data} />}
    </>
  );
}
function Cases() {
  const data = useData<
    { id: string; status: string; direction: string; created_at: number }[]
  >("/admin/cases", true);
  return (
    <>
      <Heading
        eyebrow="ANALYSIS HISTORY"
        title="Cases"
        description="Daftar case memerlukan login Admin; ringkasan case live dapat dibuka melalui tautan case."
      />
      <Notice error={data.error} retry={data.retry} />
      {data.data?.length
        ? data.data.map((c) => (
            <Link className="list-row" key={c.id} to={`/cases/${c.id}`}>
              <strong>{c.id}</strong>
              <Badge value={c.status} />
              <span>{c.direction ?? "Neutral"}</span>
              <small>{formatWib(c.created_at)}</small>
            </Link>
          ))
        : !data.error && <Empty>Belum ada analysis case.</Empty>}
    </>
  );
}
function CaseDetail({ simulation = false }: { simulation?: boolean }) {
  const { id } = useParams();
  const session = useData<{ admin: boolean }>("/auth/session");
  const path = session.data?.admin
    ? `/admin/${simulation ? "simulation" : "cases"}/${id}`
    : `/cases/${id}/public`;
  const data = useData<
    PublicCase & {
      context?: { market?: { M5: { close: number }[] } };
      result?: {
        signal?: Signal;
        analysts?: (PublicCase["analysts"][number] & {
          output?: { vote: string; summary: string };
        })[];
      };
      events?: { status: string; created_at: number }[];
    }
  >(path, true);
  const c = data.data,
    s = c?.signal ?? c?.result?.signal;
  return (
    <>
      <Heading
        eyebrow={simulation ? "SIMULATION CASE" : "ANALYSIS CASE"}
        title={id ?? "Case"}
      />
      <Notice error={data.error} retry={data.retry} />
      {c && (
        <>
          {simulation && (
            <SimulationPlayback
              events={c.events ?? []}
              status={c.status}
              prices={c.context?.market?.M5.map((x) => x.close) ?? []}
            />
          )}
          <section className="panel">
            <Badge value={c.status} />
            <p>
              {c.direction ?? "Neutral"} · {formatWib(c.created_at)}
            </p>
            {c.events && (
              <div className="timeline">
                {c.events.map((e, i) => (
                  <p key={i}>
                    <Badge value={e.status} /> {formatWib(e.created_at)}
                  </p>
                ))}
              </div>
            )}
            {(c.analysts ?? c.result?.analysts ?? []).map((a, i) => (
              <article className="list-row" key={i}>
                <strong>{roles[a.id]}</strong>
                <Badge value={a.vote ?? a.output?.vote ?? a.status} />
                <p>{a.summary ?? a.output?.summary}</p>
              </article>
            ))}
          </section>
          {s && <SignalView signal={s} />}{" "}
          {session.data?.admin && (
            <details className="panel">
              <summary>Audit snapshot (Admin)</summary>
              <pre>{JSON.stringify(c, null, 2)}</pre>
            </details>
          )}
        </>
      )}
    </>
  );
}
function Characters() {
  const state = useData<OfficeState>("/office/state", true);
  return (
    <>
      <Heading
        eyebrow="ONE ANALYST = ONE VOTE"
        title="AI Team"
        description="Enam Analyst independen, Risk Manager, dan Head Trader."
      />
      <div className="character-grid">
        {characterIds.map((id) => (
          <Link to={`/characters/${id}`} className="panel" key={id}>
            <span className="avatar">
              {id === "boss"
                ? "BG"
                : roles[id]
                    .split(" ")
                    .map((s) => s[0])
                    .join("")}
            </span>
            <h2>{roles[id]}</h2>
            <Badge value={state.data?.active ? "ACTIVE" : "MONITORING"} />
          </Link>
        ))}
      </div>
    </>
  );
}
function CharacterDetail() {
  const { id } = useParams();
  const history = useData<
    (PublicCase["analysts"][number] & { case_id: string; updated_at: number })[]
  >(`/characters/${id}`, true);
  const state = useData<OfficeState>("/office/state", true);
  return (
    <>
      <Heading
        eyebrow="CHARACTER DETAIL"
        title={roles[id ?? ""] ?? id ?? "Character"}
      />
      <section className="panel">
        <Badge value={state.data?.active ? "ACTIVE" : "MONITORING"} />
        <p>
          {id === "boss"
            ? "Final review dan tie-breaker; tidak boleh membalik majority AI."
            : id === "risk"
              ? "Evaluasi proposal risk deterministik; midpoint entry tidak diubah subjektif."
              : "Analisis independen terhadap context H1 / M15 / M5 dan enam scanner."}
        </p>
        {state.data?.active ? (
          <Link to={`/cases/${state.data.active.id}`}>
            Lihat meeting aktif ↗
          </Link>
        ) : (
          <p>Belum ada meeting aktif.</p>
        )}
        <Link to="/admin">Konfigurasi model dan prompt (Admin) ↗</Link>
      </section>
      <h2>Analysis history</h2>
      <Notice error={history.error} retry={history.retry} />
      {history.data?.map((a) => (
        <Link key={a.case_id} to={`/cases/${a.case_id}`} className="list-row">
          <Badge value={a.vote ?? a.status} />
          <strong>{a.case_id}</strong>
          <span>{a.confidence !== undefined ? `${a.confidence}%` : ""}</span>
          <p>{a.summary}</p>
          <small>{formatWib(a.updated_at)}</small>
        </Link>
      ))}
    </>
  );
}
function Simulation() {
  const navigate = useNavigate();
  const [date, setDate] = useState(""),
    [configMode, setConfigMode] = useState("CURRENT"),
    [version, setVersion] = useState(""),
    [replay, setReplay] = useState("COMPATIBLE"),
    [historical, setHistorical] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const row = await api<{ id: string }>("/admin/simulation", {
        timestamp: Date.parse(
          `${date}${date.length === 16 ? ":00" : ""}+07:00`,
        ),
        configMode,
        configVersion: version || undefined,
        replayMode: replay,
        historicalCaseId: historical || undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      navigate(`/simulation/${row.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Heading
        eyebrow="ISOLATED REPLAY"
        title="Simulation"
        description="Pipeline historical terpisah dari live. Tidak mengirim Discord."
        action={
          <Link to="/simulation/history" className="button">
            History ↗
          </Link>
        }
      />
      <section className="panel form">
        <label>
          Historical cutoff (WIB / Asia/Jakarta)
          <input
            type="datetime-local"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          Trading config
          <select
            value={configMode}
            onChange={(e) => setConfigMode(e.target.value)}
          >
            <option>CURRENT</option>
            <option>HISTORICAL</option>
          </select>
        </label>
        {configMode === "HISTORICAL" && (
          <label>
            Version
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="TRADING-CONFIG-v1"
            />
          </label>
        )}
        <label>
          Replay mode
          <select value={replay} onChange={(e) => setReplay(e.target.value)}>
            <option>COMPATIBLE</option>
            <option>STRICT</option>
          </select>
        </label>
        {replay === "STRICT" && (
          <label>
            Historical Case ID
            <input
              value={historical}
              onChange={(e) => setHistorical(e.target.value)}
            />
          </label>
        )}
        <Notice error={error} />
        <button className="primary" disabled={!date || busy} onClick={start}>
          {busy ? "Memulai…" : "Run simulation"}
        </button>
      </section>
    </>
  );
}
function SimulationPlayback({
  events,
  status,
  prices,
}: {
  events: { status: string; created_at: number }[];
  status: string;
  prices: number[];
}) {
  const [speed, setSpeed] = useState(1),
    [position, setPosition] = useState(0),
    [playing, setPlaying] = useState(true);
  const [selected, setSelected] = useState("");
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () => setPosition((p) => Math.min(p + 1, Math.max(0, events.length - 1))),
      2000 / speed,
    );
    return () => clearInterval(timer);
  }, [speed, playing, events.length]);
  const current =
    events[Math.min(position, events.length - 1)]?.status ?? status;
  const stage =
    current === "BOSS_REVIEW"
      ? "BOSS_DECISION"
      : ["COMPLETED", "NO_CONSENSUS"].includes(current)
        ? "MONITORING"
        : current === "QUEUED"
          ? "TRIGGERED"
          : current;
  return (
    <section className="office-panel">
      <div className="panel-title">
        <span>
          SIMULATION · <Badge value={current} />
        </span>
        <div className="actions">
          {[1, 2, 4].map((s) => (
            <button
              key={s}
              className={speed === s ? "selected" : ""}
              onClick={() => setSpeed(s)}
            >
              {s}×
            </button>
          ))}
          <button onClick={() => setPlaying((v) => !v)}>
            {playing ? "Pause" : "Play"}
          </button>
          <button
            disabled={!["COMPLETED", "NO_CONSENSUS", "FAILED"].includes(status)}
            onClick={() => setPosition(events.length - 1)}
          >
            Skip to Result
          </button>
        </div>
      </div>
      {supportsWebGL() ? (
        <SceneBoundary>
          <Suspense fallback={<Empty>Memuat playback…</Empty>}>
            <OfficeScene
              state={stage}
              prayer={false}
              prices={prices}
              onSelect={(id) => setSelected(roles[id] ?? id)}
            />
          </Suspense>
        </SceneBoundary>
      ) : (
        <Empty>Playback state: {current} · dashboard 2D tersedia.</Empty>
      )}
      {selected && (
        <p className="office-caption">{selected} · simulation playback</p>
      )}
    </section>
  );
}
function SimulationHistory() {
  const d = useData<
    { id: string; status: string; replay_mode: string; created_at: number }[]
  >("/admin/simulation/history", true);
  return (
    <>
      <Heading eyebrow="HISTORICAL REPLAY" title="Simulation History" />
      <Notice error={d.error} retry={d.retry} />
      {d.data?.map((s) => (
        <Link className="list-row" to={`/simulation/${s.id}`} key={s.id}>
          <strong>{s.id}</strong>
          <Badge value={s.status} />
          <span>{s.replay_mode}</span>
          <small>{formatWib(s.created_at)}</small>
        </Link>
      ))}
    </>
  );
}
function Admin({ onSessionChange }: { onSessionChange: () => void }) {
  const session = useData<{ admin: boolean }>("/auth/session");
  const [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [tab, setTab] = useState("Trading Config");
  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api("/auth/login", { password });
      setPassword("");
      session.retry();
      onSessionChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <Heading
        eyebrow="PRIVATE WORKSPACE"
        title="Admin"
        description="Konfigurasi, diagnostik, dan workflow manual."
      />
      {session.data?.admin ? (
        <>
          <div className="tabs">
            {[
              "Trading Config",
              "AI Characters",
              "Providers",
              "Emergency",
              "Usage",
            ].map((t) => (
              <button
                className={tab === t ? "selected" : ""}
                onClick={() => setTab(t)}
                key={t}
              >
                {t}
              </button>
            ))}
            <button
              onClick={async () => {
                await api("/auth/logout", {});
                session.retry();
                onSessionChange();
              }}
            >
              Logout
            </button>
          </div>
          {tab === "Trading Config" ? (
            <ConfigEditor />
          ) : tab === "AI Characters" ? (
            <CharacterEditor />
          ) : tab === "Providers" ? (
            <Providers />
          ) : tab === "Emergency" ? (
            <Emergency />
          ) : (
            <Usage />
          )}
        </>
      ) : (
        <form className="panel login form" onSubmit={login}>
          <h2>Login Admin</h2>
          <p>Gunakan password aplikasi yang telah dikonfigurasi.</p>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <Notice error={error} />
          <button className="primary">Login →</button>
        </form>
      )}
    </>
  );
}
function ConfigEditor() {
  const data = useData<{
    id: string;
    config: TradingConfig;
    versions: { id: string }[];
  }>("/admin/config");
  const [draft, setDraft] = useState<TradingConfig>(),
    [message, setMessage] = useState(""),
    [activation, setActivation] = useState("NEXT CASE");
  useEffect(() => {
    if (data.data) setDraft(data.data.config);
  }, [data.data]);
  const save = async () => {
    const confirmed =
      activation === "APPLY NOW"
        ? window.confirm(
            "Batalkan case aktif sebagai CONFIG_CHANGED dan buat case baru dengan konfigurasi ini?",
          )
        : false;
    if (activation === "APPLY NOW" && !confirmed) return;
    try {
      const res = await api<{ id: string }>("/admin/config", {
        config: draft,
        activation,
        confirmed,
      });
      setMessage(`Tersimpan: ${res.id}`);
      data.retry();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const update = <K extends keyof TradingConfig>(k: K, v: TradingConfig[K]) =>
    setDraft((d) => ({ ...(d ?? defaultConfig), [k]: v }));
  return (
    <section className="panel form">
      <Notice error={data.error} retry={data.retry} />
      <h2>Immutable Trading Config</h2>
      <p>Active version: {data.data?.id ?? "—"}</p>
      {draft && (
        <>
          <div className="form-grid">
            {(
              [
                "minRR",
                "entryAtr",
                "slAtr",
                "atrPeriod",
                "neutralScore",
                "cooldownMinutes",
                "processingDelaySeconds",
                "retentionDays",
                "historyLimit",
              ] as const
            ).map((k) => (
              <label key={k}>
                {k}
                <input
                  type="number"
                  step="any"
                  value={draft[k]}
                  onChange={(e) => update(k, Number(e.target.value))}
                />
              </label>
            ))}
            <label>
              Cooldown anchor
              <select
                value={draft.cooldownAnchor}
                onChange={(e) =>
                  update(
                    "cooldownAnchor",
                    e.target.value as TradingConfig["cooldownAnchor"],
                  )
                }
              >
                <option>FROM_TRIGGER</option>
                <option>FROM_FINAL_DECISION</option>
              </select>
            </label>
          </div>
          {(["confidenceWeights", "mtfWeights"] as const).map((k) => (
            <fieldset key={k}>
              <legend>{k} · total wajib 100%</legend>
              <div className="form-grid">
                {draft[k].map((v, i) => (
                  <label key={i}>
                    {k === "mtfWeights"
                      ? ["H1", "M15", "M5"][i]
                      : ["Scanner", "AI", "MTF"][i]}
                    <input
                      type="number"
                      value={v}
                      onChange={(e) => {
                        const next = [...draft[k]] as [number, number, number];
                        next[i] = Number(e.target.value);
                        update(k, next);
                      }}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          {(
            ["publicSignals", "publicHistory", "notifyNoConsensus"] as const
          ).map((k) => (
            <label className="check" key={k}>
              <input
                type="checkbox"
                checked={draft[k]}
                onChange={(e) => update(k, e.target.checked)}
              />
              {k}
            </label>
          ))}
          <details>
            <summary>Scanner, context, dan budget settings</summary>
            {(["scanner", "context", "budgets"] as const).map((k) => (
              <JsonField
                key={k}
                label={k}
                value={draft[k]}
                onChange={(v) => update(k, v as never)}
              />
            ))}
          </details>
          <label>
            Activation
            <select
              value={activation}
              onChange={(e) => setActivation(e.target.value)}
            >
              <option>NEXT CASE</option>
              <option>APPLY NOW</option>
            </select>
          </label>
          <button className="primary" onClick={save}>
            Save new version
          </button>
          <p role="status">{message}</p>
          <p className="muted">
            Version history: {data.data?.versions.map((v) => v.id).join(" · ")}
          </p>
        </>
      )}
    </section>
  );
}
function JsonField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [text, setText] = useState(JSON.stringify(value, null, 2)),
    [invalid, setInvalid] = useState(false);
  return (
    <label>
      {label}
      <textarea
        rows={10}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setInvalid(false);
          } catch {
            setInvalid(true);
          }
        }}
      />
      {invalid && (
        <small className="warning">
          JSON belum valid; perubahan terakhir belum diterapkan.
        </small>
      )}
    </label>
  );
}
function CharacterEditor() {
  const data = useData<CharacterConfig[]>("/admin/characters");
  const [id, setId] = useState("trend"),
    [draft, setDraft] = useState<CharacterConfig>(),
    [message, setMessage] = useState("");
  const prompts =
    useData<{ id: string; character_id: string }[]>("/admin/prompts");
  useEffect(
    () => setDraft(data.data?.find((c) => c.id === id)),
    [id, data.data],
  );
  const modelData = useState<string[]>([]);
  const [models, setModels] = modelData;
  const save = async () => {
    try {
      await api("/admin/characters", draft);
      setMessage("Karakter tersimpan dengan prompt version baru.");
      data.retry();
      prompts.retry();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  return (
    <section className="panel form">
      <Notice error={data.error} />
      <label>
        Character
        <select value={id} onChange={(e) => setId(e.target.value)}>
          {characterIds.map((c) => (
            <option key={c} value={c}>
              {roles[c]}
            </option>
          ))}
        </select>
      </label>
      {draft && (
        <>
          <div className="form-grid">
            {(["primary_provider", "fallback_provider"] as const).map((k) => (
              <label key={k}>
                {k}
                <select
                  value={draft[k]}
                  onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                >
                  {providers.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
            ))}
            {(
              [
                "primary_model",
                "fallback_model",
                "custom_instructions",
                "personality",
                "avatar",
              ] as const
            ).map((k) => (
              <label key={k}>
                {k}
                {k.includes("instructions") || k === "personality" ? (
                  <textarea
                    rows={3}
                    value={draft[k]}
                    onChange={(e) =>
                      setDraft({ ...draft, [k]: e.target.value })
                    }
                  />
                ) : (
                  <input
                    list={k.includes("model") ? "models" : undefined}
                    value={draft[k]}
                    onChange={(e) =>
                      setDraft({ ...draft, [k]: e.target.value })
                    }
                  />
                )}
              </label>
            ))}
            {(
              [
                "temperature",
                "max_output_tokens",
                "primary_timeout",
                "fallback_timeout",
              ] as const
            ).map((k) => (
              <label key={k}>
                {k}
                <input
                  type="number"
                  step="any"
                  value={draft[k]}
                  onChange={(e) =>
                    setDraft({ ...draft, [k]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
          </div>
          <datalist id="models">
            {models.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </datalist>
          <div className="actions">
            <button
              onClick={async () => {
                try {
                  const r = await api<{ models: string[] }>("/admin/models", {
                    id: draft.primary_provider,
                  });
                  setModels(r.models);
                  setMessage(
                    `${r.models.length} models loaded; custom model ID tetap tersedia.`,
                  );
                } catch (e) {
                  setMessage((e as Error).message);
                }
              }}
            >
              Discover primary models
            </button>
            <button className="primary" onClick={save}>
              Save character & prompt
            </button>
          </div>
          <p>{message}</p>
          <h3>Prompt rollback</h3>
          {prompts.data
            ?.filter((p) => p.character_id === id)
            .map((p) => (
              <div className="list-row" key={p.id}>
                <small>{p.id}</small>
                <button
                  onClick={async () => {
                    try {
                      await api("/admin/rollback", { id: p.id });
                      data.retry();
                      setMessage("Prompt version dipulihkan.");
                    } catch (e) {
                      setMessage((e as Error).message);
                    }
                  }}
                >
                  Restore
                </button>
              </div>
            ))}
        </>
      )}
    </section>
  );
}
function Providers() {
  const d = useData<
    {
      id: string;
      state: string;
      failures: number;
      policy: {
        retries: number;
        jitter: boolean;
        threshold: number;
        cooldownMs: number;
      };
    }[]
  >("/admin/providers", true);
  const health = useData<{ configured: { id: string; configured: boolean }[] }>(
    "/admin/health",
  );
  const [message, setMessage] = useState("");
  return (
    <section className="panel">
      <h2>Provider health</h2>
      <p>Health pasif dan tes manual. Tidak ada polling AI berbayar.</p>
      <Notice error={d.error} />
      {d.data?.map((p) => (
        <div className="list-row" key={p.id}>
          <strong>{p.id}</strong>
          <Badge value={p.state} />
          <span>
            {health.data?.configured.find((c) => c.id === p.id)?.configured
              ? "Secret configured"
              : "Secret missing"}
          </span>
          <button
            onClick={async () => {
              try {
                await api("/admin/test-provider", { id: p.id });
                setMessage(`${p.id}: koneksi berhasil`);
                d.retry();
              } catch (e) {
                setMessage(`${p.id}: ${(e as Error).message}`);
              }
            }}
          >
            Test connection
          </button>
          <ProviderPolicyEditor
            provider={p.id}
            initial={p.policy}
            onSaved={d.retry}
          />
        </div>
      ))}
      <p role="status">{message}</p>
    </section>
  );
}
function ProviderPolicyEditor({
  provider,
  initial,
  onSaved,
}: {
  provider: string;
  initial: {
    retries: number;
    jitter: boolean;
    threshold: number;
    cooldownMs: number;
  };
  onSaved: () => void;
}) {
  const [policy, setPolicy] = useState(initial),
    [message, setMessage] = useState("");
  return (
    <details>
      <summary>Retry & circuit settings</summary>
      <div className="form-grid">
        {(["retries", "threshold", "cooldownMs"] as const).map((k) => (
          <label key={k}>
            {k}
            <input
              type="number"
              value={policy[k]}
              onChange={(e) =>
                setPolicy({ ...policy, [k]: Number(e.target.value) })
              }
            />
          </label>
        ))}
        <label className="check">
          <input
            type="checkbox"
            checked={policy.jitter}
            onChange={(e) => setPolicy({ ...policy, jitter: e.target.checked })}
          />
          Jitter
        </label>
      </div>
      <button
        onClick={async () => {
          try {
            await api("/admin/providers", { id: provider, policy });
            setMessage("Policy tersimpan");
            onSaved();
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        Save policy
      </button>
      <p role="status">{message}</p>
    </details>
  );
}
function Emergency() {
  const navigate = useNavigate();
  const [focus, setFocus] = useState("NONE"),
    [send, setSend] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="panel form">
      <h2>Call Emergency Meeting</h2>
      <p>
        Menjalankan seluruh pipeline dari candle tertutup terbaru. Focus tidak
        memaksa vote AI.
      </p>
      <label>
        Focus
        <select value={focus} onChange={(e) => setFocus(e.target.value)}>
          <option value="NONE">Neutral Analysis</option>
          <option value="BUY">Investigate BUY</option>
          <option value="SELL">Investigate SELL</option>
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={send}
          onChange={(e) => setSend(e.target.checked)}
        />
        Send to Discord
      </label>
      <Notice error={error} />
      <button
        className="primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const c = await api<{ id: string }>("/admin/emergency", {
              focus,
              sendDiscord: send,
              idempotencyKey: crypto.randomUUID(),
            });
            navigate(`/cases/${c.id}`);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Memulai…" : "CALL EMERGENCY MEETING"}
      </button>
      <button
        onClick={async () => {
          try {
            await api("/admin/scan", {});
            setError("Scan diminta. Periksa halaman Scanners.");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Run scanner check
      </button>
    </section>
  );
}
function Usage() {
  const [review, setReview] = useState<{
    key: string;
    action: "MARK_SENT" | "DISMISS" | "RETRY";
  }>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const d = useData<{ day: string; calls: number; tokens: number }>(
    "/admin/usage",
    true,
  );
  const deliveries = useData<
    {
      key: string;
      kind: string;
      status: string;
      attempts: number;
      last_error: string;
    }[]
  >("/admin/deliveries", true);
  return (
    <section className="panel">
      <h2>Usage today · WIB</h2>
      <div className="risk-grid">
        <div>
          <small>AI calls</small>
          <strong>{d.data?.calls ?? 0}</strong>
        </div>
        <div>
          <small>Estimated tokens</small>
          <strong>{d.data?.tokens ?? 0}</strong>
        </div>
      </div>
      <h3>Discord delivery audit</h3>
      <Notice error={d.error} retry={d.retry} />
      <Notice error={deliveries.error} retry={deliveries.retry} />
      <Notice error={error} />
      <p>
        UNKNOWN berarti hasil kirim belum pasti. Periksa Discord sebelum
        menandai terkirim; pesan ini tidak dikirim ulang otomatis.
      </p>
      {review && (
        <div className="notice" role="alert">
          <span>
            {review.action === "MARK_SENT"
              ? "Saya sudah memeriksa Discord dan pesan ini terkirim."
              : review.action === "DISMISS"
                ? "Abaikan pengiriman ini dan simpan keputusan di audit."
                : "Kirim ulang pengiriman yang gagal. Riwayat review akan disimpan."}
          </span>
          <button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setError(undefined);
              try {
                await api("/admin/deliveries/review", {
                  ...review,
                  confirmed: true,
                });
                setReview(undefined);
                deliveries.retry();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            Konfirmasi
          </button>
          <button disabled={saving} onClick={() => setReview(undefined)}>
            Batal
          </button>
        </div>
      )}
      {!deliveries.loading && !deliveries.data?.length && (
        <Empty>Belum ada pengiriman Discord.</Empty>
      )}
      {deliveries.data?.map((v) => (
        <div className="list-row" key={v.key}>
          <span>{v.kind}</span>
          <Badge value={v.status} />
          <small>{v.last_error}</small>
          <small>{v.attempts} percobaan</small>
          {["UNKNOWN", "FAILED"].includes(v.status) && (
            <div className="actions">
              <button
                disabled={saving}
                onClick={() => setReview({ key: v.key, action: "MARK_SENT" })}
              >
                Tandai terkirim
              </button>
              <button
                disabled={saving}
                onClick={() => setReview({ key: v.key, action: "DISMISS" })}
              >
                Abaikan
              </button>
              {v.status === "FAILED" && (
                <button
                  disabled={saving}
                  onClick={() => setReview({ key: v.key, action: "RETRY" })}
                >
                  Kirim ulang
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
