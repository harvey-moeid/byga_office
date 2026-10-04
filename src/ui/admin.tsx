import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  characterIds,
  avatarPresets,
  defaultConfig,
  providers,
  scannerNames,
  type CharacterConfig,
  type TradingConfig,
} from "../core/contracts";
import { api, useData } from "./data";
import { Badge, Empty, Heading, Notice, roles } from "./shared";
export default function Admin({
  onSessionChange,
}: {
  onSessionChange: () => void;
}) {
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
            <label>
              Minimal Scanner Consensus
              <select
                value={draft.scannerConsensusMin}
                onChange={(e) =>
                  update("scannerConsensusMin", Number(e.target.value))
                }
                aria-describedby="scanner-consensus-help"
              >
                {scannerNames.map((_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1} dari {scannerNames.length} scanner
                  </option>
                ))}
              </select>
              <small id="scanner-consensus-help" className="muted">
                Jumlah minimal scanner BUY atau SELL untuk memicu analisis
                otomatis. Jumlah searah harus lebih besar dari arah lawan; hasil
                seri tidak memicu. Default: 2 dari 6.
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
