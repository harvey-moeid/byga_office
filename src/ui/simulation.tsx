import { Suspense, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { formatWib } from "../core/contracts";
import { api, useData } from "./data";
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
export default function Simulation() {
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
export function SimulationPlayback({
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
export function SimulationHistory() {
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
