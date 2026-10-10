import { Suspense, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { formatWib } from "../core/contracts";
import { useData, useOperationIntent } from "./data";
import {
  Badge,
  Empty,
  Heading,
  Notice,
  PendingOperation,
  OfficeScene,
  SceneBoundary,
  roles,
  supportsWebGL,
} from "./shared";
export default function Simulation() {
  const navigate = useNavigate();
  const operation = useOperationIntent("simulation");
  const saved = operation.pending?.payload;
  const savedTimestamp =
    typeof saved?.timestamp === "number" && Number.isFinite(saved.timestamp)
      ? saved.timestamp
      : undefined;
  const [date, setDate] = useState(
      savedTimestamp
        ? new Date(savedTimestamp + 7 * 3600000).toISOString().slice(0, 16)
        : "",
    ),
    [configMode, setConfigMode] = useState(
      saved?.configMode === "HISTORICAL" ? "HISTORICAL" : "CURRENT",
    ),
    [version, setVersion] = useState(
      typeof saved?.configVersion === "string" ? saved.configVersion : "",
    ),
    [replay, setReplay] = useState(
      saved?.replayMode === "STRICT" ? "STRICT" : "COMPATIBLE",
    ),
    [historical, setHistorical] = useState(
      typeof saved?.historicalCaseId === "string" ? saved.historicalCaseId : "",
    ),
    [error, setError] = useState("");
  const start = async (retry = false) => {
    setError("");
    try {
      const payload = {
        timestamp: Date.parse(
          `${date}${date.length === 16 ? ":00" : ""}+07:00`,
        ),
        configMode,
        ...(version ? { configVersion: version } : {}),
        replayMode: replay,
        ...(historical ? { historicalCaseId: historical } : {}),
      };
      const row = retry
        ? await operation.retry<{ id: string }>("/admin/simulation")
        : await operation.send<{ id: string }>("/admin/simulation", payload);
      navigate(`/simulation/${row.id}`);
    } catch (e) {
      setError((e as Error).message);
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
        <fieldset
          className="editor-fields"
          disabled={operation.busy || !!operation.pending}
        >
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
        </fieldset>
        <Notice error={error} />
        <PendingOperation
          operation={operation}
          retry={() => void start(true)}
        />
        <button
          className="primary"
          disabled={
            !date ||
            operation.busy ||
            !!operation.pending ||
            (configMode === "HISTORICAL" && !version) ||
            (replay === "STRICT" && !historical)
          }
          onClick={() => void start()}
        >
          {operation.busy ? "Memulai…" : "Run simulation"}
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
