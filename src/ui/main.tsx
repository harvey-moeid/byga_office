import React, { Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useParams,
  useLocation,
} from "react-router-dom";
import {
  MARKET,
  characterIds,
  defaultConfig,
  type AvatarPreset,
  type CharacterId,
  formatPrice,
  formatWib,
  scannerNames,
  type ScannerOutput,
  type Signal,
} from "../core/contracts";
import "./style.css";
import { useData, useOfficeState, useOnline } from "./data";
import {
  useMeetingPresentation,
  MeetingStatus,
  MeetingDetail,
  SpeechBubble,
} from "./meeting-view";
import {
  Badge,
  Empty,
  Heading,
  Notice,
  OfficeScene,
  SceneBoundary,
  roles,
  supportsWebGL,
} from "./shared";
const Admin = lazy(() => import("./admin"));
const Simulation = lazy(() => import("./simulation"));
const SimulationHistory = lazy(() =>
  import("./simulation").then((m) => ({ default: m.SimulationHistory })),
);
const SimulationPlayback = lazy(() =>
  import("./simulation").then((m) => ({ default: m.SimulationPlayback })),
);
interface OfficeState {
  scanner_consensus_min?: number;
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
    provider?: string;
    model?: string;
    validationErrors?: string[];
  }[];
}
function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}
function AppLayout() {
  const session = useData<{ admin: boolean }>("/auth/session");
  const online = useOnline();
  const location = useLocation();
  const home = location.pathname === "/" || location.pathname === "/office";
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  return (
    <div className={`shell${home ? " home-shell" : ""}`}>
      {!online && (
        <div className="connection-banner" role="status">
          Offline · Data terakhir belum diperbarui. Akan tersambung ulang
          otomatis.
        </div>
      )}
      {home && (
        <button
          className="home-menu-button"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? "app-navigation" : undefined}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? "Tutup" : "Menu"}{" "}
          <span aria-hidden="true">{menuOpen ? "×" : "☰"}</span>
        </button>
      )}
      {home && menuOpen && (
        <button
          className="home-menu-dismiss"
          aria-label="Tutup menu"
          onClick={() => setMenuOpen(false)}
        />
      )}
      {(!home || menuOpen) && (
        <aside
          id="app-navigation"
          className={`sidebar${home ? " home-menu" : ""}`}
        >
          <Link to="/" className="brand">
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
              ["/", "◈", "Home"],
              ["/operations", "▤", "Operations"],
              ["/scanners", "▦", "Scanners"],
              ["/signals", "↗", "Signals"],
              ["/cases", "▤", "Cases"],
              ["/characters", "◎", "AI Team"],
              ["/simulation", "▷", "Simulation"],
              ["/admin", "⚙", "Admin"],
            ].map(([path, icon, title]) => (
              <NavLink
                key={path}
                to={path}
                end={path === "/"}
                onClick={() => setMenuOpen(false)}
              >
                <span aria-hidden="true">{icon}</span>
                {title}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <span className="dot" /> {MARKET} ONLY
            <small>Asia/Jakarta · WIB</small>
          </div>
        </aside>
      )}
      <main>
        {!home && (
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
        )}
        <Suspense fallback={<Empty>Memuat halaman…</Empty>}>
          <Routes>
            <Route path="/" element={<Dashboard immersive />} />
            <Route path="/office" element={<Navigate to="/" replace />} />
            <Route path="/operations" element={<Dashboard />} />
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
        </Suspense>
        {!home && (
          <footer>
            AI Analysts. Deterministic Systems. One Trading Office.
            <span>Analisis trading · tanpa eksekusi order</span>
          </footer>
        )}
      </main>
    </div>
  );
}
function Dashboard({ immersive = false }: { immersive?: boolean }) {
  const state = useOfficeState<OfficeState>(),
    market = useData<Market>("/market/status", true),
    characters =
      useData<{ id: CharacterId; avatar: AvatarPreset }[]>("/characters");
  const [view, setView] = useState("3D");
  const [selected, setSelected] = useState<string>();
  const [tf, setTf] = useState("M5");
  const busy = !!state.data?.active;
  useEffect(() => {
    const fallback = () => setView("Operations");
    window.addEventListener("byga:webgl-lost", fallback);
    return () => window.removeEventListener("byga:webgl-lost", fallback);
  }, []);
  const office = state.data?.office ?? "CONNECTING";
  const health = useData<Record<string, string>>("/health", true);
  const render3D = view === "3D" && supportsWebGL();
  const meeting = useMeetingPresentation(render3D);
  const notices = (
    <div className={immersive ? "home-notices" : undefined}>
      <Notice error={state.error} retry={state.retry} />
      <Notice error={market.error} retry={market.retry} />
      {market.data?.development && (
        <div className="notice">
          Lingkungan pengembangan lokal · candle fixture bukan data pasar
          produksi.
        </div>
      )}
    </div>
  );
  return (
    <>
      {!immersive && (
        <Heading
          eyebrow="LIVE OPERATIONS"
          title="Trading Office"
          description="Enam sistem deterministik. Delapan perspektif AI."
          action={
            <div className="actions">
              <Link className="button primary" to="/admin">
                Emergency Meeting ↗
              </Link>
            </div>
          }
        />
      )}
      {!immersive && notices}
      {!immersive && (
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
              {state.data?.scanners.filter((s) => s.direction === "BUY")
                .length ?? 0}
              <em> BUY </em>
              {state.data?.scanners.filter((s) => s.direction === "SELL")
                .length ?? 0}
              <em> SELL</em>
            </strong>
            <small>
              Minimal{" "}
              {state.data?.scanner_consensus_min ??
                defaultConfig.scannerConsensusMin}{" "}
              · majority unik
            </small>
          </div>
        </div>
      )}
      <section
        className={`office-panel${immersive ? " home-stage" : ""}${immersive && !render3D ? " home-fallback" : ""}`}
        aria-label="Kantor BYGA"
      >
        <div className={`panel-title${immersive ? " home-hud" : ""}`}>
          <div>
            {immersive ? (
              <>
                <span className="eyebrow">BYGA / AI TRADING OFFICE</span>
                <h1>Trading Office</h1>
                <span className="home-state">
                  <span className="dot" />
                  {office.replaceAll("_", " ")}
                </span>
              </>
            ) : (
              <>
                <span className="dot" /> BYGA / LIVING OFFICE
              </>
            )}
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
        {immersive && notices}
        {render3D ? (
          <SceneBoundary>
            <Suspense fallback={<Empty>Memuat kantor 3D…</Empty>}>
              <OfficeScene
                state={meeting.active ? meeting.playback!.stage : office}
                meetingId={
                  meeting.active ? meeting.snapshot?.case_id : undefined
                }
                speech={meeting.active ? meeting.current : undefined}
                onSpeechDetails={meeting.openDetails}
                onSpeechReady={meeting.onSpeechReady}
                onSelect={setSelected}
                prices={market.data?.timeframes.M5.map((c) => c.close) ?? []}
                avatars={Object.fromEntries(
                  (Array.isArray(characters.data) ? characters.data : []).map(
                    (character) => [character.id, character.avatar],
                  ),
                )}
              />
            </Suspense>
          </SceneBoundary>
        ) : (
          <div className="operations-grid" aria-label="Tim operasi">
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
        <MeetingStatus presentation={meeting} />
        {!render3D && meeting.active && meeting.current && (
          <div className="fallback-meeting">
            <SpeechBubble
              turn={meeting.current}
              onDetails={meeting.openDetails}
            />
          </div>
        )}
        <MeetingDetail
          turn={meeting.detail}
          caseId={meeting.snapshot?.case_id}
          onClose={() => meeting.openDetails(undefined)}
        />
        {!immersive && (
          <div className="office-caption">
            <span>
              ISOMETRIC VIEW ·{" "}
              {view === "3D" ? "Drag to orbit · pinch to zoom" : "2D dashboard"}
            </span>
            <span>{busy ? "Meeting berjalan" : "Monitoring market"}</span>
          </div>
        )}
      </section>
      {!immersive && (
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
      )}
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
              <h3>{s.market}</h3>
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
      <h2>{s.market} · {s.signal_id}</h2>
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
                {session.data?.admin && a.provider && (
                  <small>
                    Provider {a.provider} · Model {a.model ?? "—"}
                  </small>
                )}
                {session.data?.admin && !!a.validationErrors?.length && (
                  <p className="warning">{a.validationErrors.join(" · ")}</p>
                )}
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
  const session = useData<{ admin: boolean }>("/auth/session");
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
          {a.warning && <p className="warning">{a.warning}</p>}
          {session.data?.admin && a.provider && (
            <small>
              Provider {a.provider} · Model {a.model ?? "—"}
            </small>
          )}
          <small>{formatWib(a.updated_at)}</small>
        </Link>
      ))}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
