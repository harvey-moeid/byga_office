import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  characterIds,
  avatarPresets,
  defaultConfig,
  configSchema,
  providers,
  providerLabel,
  workersAIModel,
  analysisGroups,
  type CharacterConfig,
  type TradingConfig,
} from "../core/contracts";
import { api, ApiError, useAction, useData, useOperationIntent } from "./data";
import { configWriteSchema, type ConfigWriteResult } from "../core/api";
import { useSession } from "./session";
import {
  Badge,
  Empty,
  Heading,
  Notice,
  PendingOperation,
  roles,
} from "./shared";
export default function Admin() {
  const session = useSession();
  const authAction = useAction();
  const [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [tab, setTab] = useState("Trading Config");
  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    await authAction.run(async () => {
      try {
        setError("");
        await api("/auth/login", { password });
        setPassword("");
        session.retry();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };
  return (
    <>
      <Heading
        eyebrow="PRIVATE WORKSPACE"
        title="Admin"
        description="Konfigurasi, diagnostik, dan workflow manual."
      />
      <Notice
        error={error || session.error}
        retry={session.error ? session.retry : undefined}
      />
      {session.loading ? (
        <Empty>Memeriksa akses Admin…</Empty>
      ) : session.data?.admin ? (
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
              disabled={authAction.busy}
              onClick={async () => {
                await authAction.run(async () => {
                  try {
                    setError("");
                    await api("/auth/logout", {});
                    session.invalidate();
                  } catch (e) {
                    setError(
                      `Logout belum terkonfirmasi. ${(e as Error).message}`,
                    );
                    session.retry();
                  }
                });
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
              disabled={authAction.busy}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <button className="primary" disabled={authAction.busy}>
            {authAction.busy ? "Memproses…" : "Login →"}
          </button>
        </form>
      )}
    </>
  );
}
function ConfigEditor() {
  const operation = useOperationIntent("config");
  const data = useData<{
    id: string;
    config: TradingConfig;
    versions: { id: string }[];
  }>("/admin/config");
  const restored = configSchema.safeParse(operation.pending?.payload.config);
  const [draft, setDraft] = useState<TradingConfig | undefined>(
      restored.success ? restored.data : undefined,
    ),
    [message, setMessage] = useState(""),
    [activation, setActivation] = useState(
      operation.pending?.payload.activation === "APPLY NOW"
        ? "APPLY NOW"
        : "NEXT CASE",
    );
  const dirty = useRef(!!operation.pending),
    baseVersion = useRef(
      typeof operation.pending?.payload.expectedVersion === "string"
        ? operation.pending.payload.expectedVersion
        : "",
    );
  const [conflict, setConflict] = useState(false);
  const [editorRevision, resetEditors] = useState(0);
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!data.data) return;
    if (dirty.current) {
      if (data.data.id !== baseVersion.current) setConflict(true);
      return;
    }
    baseVersion.current = data.data.id;
    setDraft(data.data.config);
    setConflict(false);
  }, [data.data]);
  const save = async (retry = false) => {
    if (operation.busy) return;
    const confirmed =
      !retry && activation === "APPLY NOW"
        ? window.confirm(
            "Batalkan case aktif sebagai CONFIG_CHANGED dan buat case baru dengan konfigurasi ini?",
          )
        : false;
    if (!retry && activation === "APPLY NOW" && !confirmed) return;
    try {
      setMessage("");
      const payload = retry
        ? undefined
        : configWriteSchema.parse({
            config: draft,
            activation,
            confirmed,
            expectedVersion: baseVersion.current,
          });
      const res = retry
        ? await operation.retry<ConfigWriteResult>("/admin/config")
        : await operation.send<ConfigWriteResult>("/admin/config", payload!);
      dirty.current = false;
      baseVersion.current = res.id;
      setConflict(false);
      setMessage(
        `Tersimpan: ${res.id}${res.replacement_case_id ? ` · Case pengganti: ${res.replacement_case_id}` : ""}`,
      );
      data.retry();
    } catch (e) {
      setMessage((e as Error).message);
      if (e instanceof ApiError && e.code === "CONFIG_CONFLICT") {
        setConflict(true);
        data.retry();
      }
    }
  };
  const update = <K extends keyof TradingConfig>(k: K, v: TradingConfig[K]) => {
    dirty.current = true;
    setDraft((d) => ({ ...(d ?? defaultConfig), [k]: v }));
  };
  const valid = configSchema.safeParse(draft);
  return (
    <section className="panel form">
      <Notice error={data.error} retry={data.retry} />
      <h2>Immutable Trading Config</h2>
      <p>Active version: {data.data?.id ?? "—"}</p>
      {conflict && (
        <div className="notice" role="alert">
          Konfigurasi server berubah. Draft belum ditimpa. Tinjau versi terbaru
          sebelum menyimpan.
          <button
            disabled={operation.busy || !!operation.pending}
            onClick={() => {
              if (
                dirty.current &&
                !window.confirm(
                  "Buang perubahan draft dan gunakan konfigurasi terbaru?",
                )
              )
                return;
              dirty.current = false;
              baseVersion.current = data.data?.id ?? "";
              setDraft(data.data?.config);
              setConflict(false);
              setInvalid({});
              resetEditors((v) => v + 1);
            }}
          >
            Gunakan versi terbaru
          </button>
        </div>
      )}
      <PendingOperation operation={operation} retry={() => void save(true)} />
      {draft && (
        <>
          <fieldset
            className="editor-fields"
            disabled={operation.busy || !!operation.pending}
          >
            <div className="form-grid">
              <label>
                Minimal Group Consensus
                <select
                  value={draft.scannerConsensusMin}
                  onChange={(e) =>
                    update("scannerConsensusMin", Number(e.target.value))
                  }
                  aria-describedby="scanner-consensus-help"
                >
                  {analysisGroups.map((_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1} dari {analysisGroups.length} group
                    </option>
                  ))}
                </select>
                <small id="scanner-consensus-help" className="muted">
                  Konsensus deterministik SMC/ICT, Indikator, Volume, dan
                  Derivatives / Market Positioning. Minimal 2 dari 4 group harus
                  searah untuk memicu analisis otomatis. Scanner tetap aktif
                  sebagai telemetry. Default: 2 dari 4.
                </small>
              </label>
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
                          const next = [...draft[k]] as [
                            number,
                            number,
                            number,
                          ];
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
                  key={`${k}:${baseVersion.current}:${editorRevision}`}
                  label={k}
                  value={draft[k]}
                  onValidity={(valid) => {
                    if (!valid) dirty.current = true;
                    setInvalid((s) => ({ ...s, [k]: !valid }));
                  }}
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
          </fieldset>
          {!valid.success && (
            <Notice
              error={valid.error.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join(" · ")}
            />
          )}
          <button
            className="primary"
            disabled={
              operation.busy ||
              !!operation.pending ||
              conflict ||
              Object.values(invalid).some(Boolean) ||
              !valid.success
            }
            onClick={() => void save()}
          >
            {operation.busy ? "Menyimpan…" : "Save new version"}
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
  onValidity,
}: {
  label: string;
  value: unknown;
  onChange: (v: unknown) => void;
  onValidity: (valid: boolean) => void;
}) {
  const [text, setText] = useState(JSON.stringify(value, null, 2)),
    [invalid, setInvalid] = useState(false);
  const last = useRef(JSON.stringify(value));
  useEffect(() => {
    const encoded = JSON.stringify(value);
    if (encoded !== last.current) {
      last.current = encoded;
      setText(JSON.stringify(value, null, 2));
      setInvalid(false);
      onValidity(true);
    }
  }, [value, onValidity]);
  return (
    <label>
      {label}
      <textarea
        aria-label={label}
        aria-invalid={invalid}
        rows={10}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const parsed: unknown = JSON.parse(e.target.value);
            last.current = JSON.stringify(parsed);
            onChange(parsed);
            setInvalid(false);
            onValidity(true);
          } catch {
            setInvalid(true);
            onValidity(false);
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
  const action = useAction();
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
  const [models, setModels] = useState({
    primary: [] as string[],
    fallback: [] as string[],
  });
  const save = async () => {
    await action.run(async () => {
      try {
        await api("/admin/characters", draft);
        setMessage("Karakter tersimpan dengan prompt version baru.");
        data.retry();
        prompts.retry();
      } catch (e) {
        setMessage((e as Error).message);
      }
    });
  };
  return (
    <section className="panel form">
      <Notice error={data.error} />
      <label>
        Character
        <select
          disabled={action.busy}
          value={id}
          onChange={(e) => setId(e.target.value)}
        >
          {characterIds.map((c) => (
            <option key={c} value={c}>
              {roles[c]}
            </option>
          ))}
        </select>
      </label>
      {draft && (
        <>
          <fieldset className="editor-fields" disabled={action.busy}>
            <div className="form-grid">
              {(["primary_provider", "fallback_provider"] as const).map((k) => (
                <label key={k}>
                  {k}
                  <select
                    aria-label={k}
                    value={draft[k]}
                    onChange={(e) => {
                      const provider = e.target
                        .value as CharacterConfig[typeof k];
                      setDraft({
                        ...draft,
                        [k]: provider,
                        ...(provider === "workers-ai"
                          ? {
                              [k === "primary_provider"
                                ? "primary_model"
                                : "fallback_model"]: workersAIModel,
                            }
                          : {}),
                      });
                      setModels((m) => ({
                        ...m,
                        [k === "primary_provider" ? "primary" : "fallback"]: [],
                      }));
                    }}
                  >
                    {providers.map((p) => (
                      <option key={p} value={p}>
                        {providerLabel(p)}
                      </option>
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
                      list={k.includes("model") ? `${k}-options` : undefined}
                      value={draft[k]}
                      onChange={(e) =>
                        setDraft({ ...draft, [k]: e.target.value })
                      }
                    />
                  )}
                </label>
              ))}
              <label>
                avatar
                <select
                  value={draft.avatar}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      avatar: e.target.value as CharacterConfig["avatar"],
                    })
                  }
                >
                  {avatarPresets.map((preset) => (
                    <option key={preset} value={preset}>
                      {preset}
                    </option>
                  ))}
                </select>
              </label>
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
          </fieldset>
          {(["primary", "fallback"] as const).map((role) => (
            <datalist key={role} id={`${role}_model-options`}>
              {models[role].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </datalist>
          ))}
          <div className="actions">
            {(["primary", "fallback"] as const).map((role) => (
              <button
                key={role}
                disabled={action.busy}
                onClick={async () => {
                  await action.run(async () => {
                    try {
                      const r = await api<{ models: string[] }>(
                        "/admin/models",
                        {
                          id: draft[`${role}_provider`],
                        },
                      );
                      setModels((m) => ({ ...m, [role]: r.models }));
                      setMessage(
                        `${r.models.length} models loaded; custom model ID tetap tersedia.`,
                      );
                    } catch (e) {
                      setMessage((e as Error).message);
                    }
                  });
                }}
              >
                Discover {role} models
              </button>
            ))}
            <button className="primary" disabled={action.busy} onClick={save}>
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
                  disabled={action.busy}
                  onClick={async () => {
                    await action.run(async () => {
                      try {
                        await api("/admin/rollback", { id: p.id });
                        data.retry();
                        setMessage("Prompt version dipulihkan.");
                      } catch (e) {
                        setMessage((e as Error).message);
                      }
                    });
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
  const action = useAction();
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
      <Notice error={health.error} retry={health.retry} />
      {d.data?.map((p) => (
        <div className="list-row" key={p.id}>
          <strong>{providerLabel(p.id)}</strong>
          <Badge value={p.state} />
          <span>
            {health.loading
              ? "Memeriksa konfigurasi…"
              : health.error ||
                  !health.data ||
                  !health.data.configured.some((c) => c.id === p.id)
                ? "Configuration unknown"
                : health.data.configured.find((c) => c.id === p.id)?.configured
                  ? p.id === "workers-ai"
                    ? "AI binding configured"
                    : "Secret configured"
                  : p.id === "workers-ai"
                    ? "AI binding missing"
                    : "Secret missing"}
          </span>
          <button
            disabled={action.busy}
            onClick={async () => {
              await action.run(async () => {
                try {
                  await api("/admin/test-provider", { id: p.id });
                  setMessage(`${p.id}: koneksi berhasil`);
                  d.retry();
                } catch (e) {
                  setMessage(`${p.id}: ${(e as Error).message}`);
                }
              });
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
  const action = useAction();
  const [policy, setPolicy] = useState(initial),
    [message, setMessage] = useState("");
  return (
    <details>
      <summary>Retry & circuit settings</summary>
      <fieldset className="editor-fields" disabled={action.busy}>
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
              onChange={(e) =>
                setPolicy({ ...policy, jitter: e.target.checked })
              }
            />
            Jitter
          </label>
        </div>
      </fieldset>
      <button
        disabled={action.busy}
        onClick={async () => {
          await action.run(async () => {
            try {
              await api("/admin/providers", { id: provider, policy });
              setMessage("Policy tersimpan");
              onSaved();
            } catch (e) {
              setMessage((e as Error).message);
            }
          });
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
  const operation = useOperationIntent("emergency"),
    scan = useAction();
  const [focus, setFocus] = useState(
      String(operation.pending?.payload.focus ?? "NONE"),
    ),
    [send, setSend] = useState(operation.pending?.payload.sendDiscord === true),
    [error, setError] = useState("");
  const start = async (retry = false) => {
    try {
      setError("");
      const c = retry
        ? await operation.retry<{ id: string }>("/admin/emergency")
        : await operation.send<{ id: string }>("/admin/emergency", {
            focus,
            sendDiscord: send,
          });
      navigate(`/cases/${c.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="panel form">
      <h2>Call Emergency Meeting</h2>
      <p>
        Menjalankan seluruh pipeline dari candle tertutup terbaru. Focus tidak
        memaksa vote AI.
      </p>
      <label>
        Focus
        <select
          disabled={operation.busy || !!operation.pending}
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
        >
          <option value="NONE">Neutral Analysis</option>
          <option value="BUY">Investigate BUY</option>
          <option value="SELL">Investigate SELL</option>
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          disabled={operation.busy || !!operation.pending}
          checked={send}
          onChange={(e) => setSend(e.target.checked)}
        />
        Send to Discord
      </label>
      <Notice error={error} />
      <PendingOperation operation={operation} retry={() => void start(true)} />
      <button
        className="primary"
        disabled={operation.busy || !!operation.pending}
        onClick={() => void start()}
      >
        {operation.busy ? "Memulai…" : "CALL EMERGENCY MEETING"}
      </button>
      <button
        disabled={scan.busy}
        onClick={async () => {
          await scan.run(async () => {
            try {
              await api("/admin/scan", {});
              setError("Scan diminta. Periksa halaman Scanners.");
            } catch (e) {
              setError((e as Error).message);
            }
          });
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
