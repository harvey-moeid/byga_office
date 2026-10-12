import { useEffect, useState } from "react";
import {
  credentialWriteSchema,
  keyProviders,
  type CredentialInventory,
  type KeyProvider,
} from "../core/credentials";
import { formatWib, providerLabel } from "../core/contracts";
import { api, ApiError, authExpiredEvent, useAction, useData } from "./data";
import { Notice } from "./shared";

export function ProviderKeys({ onSaved }: { onSaved: () => void }) {
  const inventory = useData<CredentialInventory>("/admin/credentials");
  const action = useAction();
  const [provider, setProvider] = useState<KeyProvider>("openrouter");
  const [key, setKey] = useState("");
  const [draftVersion, setDraftVersion] = useState<string | null>();
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const status = (
    Array.isArray(inventory.data?.items) ? inventory.data.items : []
  ).find((item) => item.id === provider);
  const ready =
    inventory.data?.storage_ready === true && !!status && !inventory.error;
  const valid = credentialWriteSchema.safeParse({
    id: provider,
    action: "SAVE",
    key,
    expectedVersion:
      draftVersion === undefined ? (status?.version ?? null) : draftVersion,
  }).success;
  useEffect(() => {
    const clear = () => {
      setKey("");
      setDraftVersion(undefined);
      setShow(false);
      setMessage("");
      setError("");
    };
    window.addEventListener(authExpiredEvent, clear);
    return () => window.removeEventListener(authExpiredEvent, clear);
  }, []);
  const send = async (remove = false) => {
    if (!status || (!remove && !ready)) return;
    if (
      remove &&
      !window.confirm(
        `Hapus API key ${providerLabel(provider)} yang disimpan dari UI? Key dari konfigurasi server, jika tersedia, akan digunakan kembali.`,
      )
    )
      return;
    const payload = remove
      ? {
          id: provider,
          action: "DELETE",
          confirmed: true,
          expectedVersion: status.version,
        }
      : {
          id: provider,
          action: "SAVE",
          key,
          expectedVersion:
            draftVersion === undefined ? status.version : draftVersion,
        };
    const parsed = credentialWriteSchema.safeParse(payload);
    if (!parsed.success) return;
    await action.run(async () => {
      setError("");
      setMessage("");
      setKey("");
      setDraftVersion(undefined);
      setShow(false);
      try {
        const result = await api<CredentialInventory>(
          "/admin/credentials",
          parsed.data,
        );
        inventory.replace(result);
        setMessage(
          remove
            ? "Key dari UI dihapus. Status provider diperbarui."
            : "API key tersimpan. Gunakan Test connection untuk memeriksa akses provider.",
        );
        onSaved();
      } catch (error) {
        // Never reflect response text or a submitted credential into the page.
        setError(
          error instanceof ApiError && error.status === 409
            ? "Key sudah berubah. Status dimuat ulang; masukkan ulang key untuk perubahan berikutnya."
            : error instanceof ApiError &&
                error.status === 503 &&
                error.code === "CREDENTIAL_STORAGE_UNAVAILABLE"
              ? "Penyimpanan API key belum tersedia di server."
              : "Permintaan belum dapat dipastikan. Periksa status terbaru sebelum mencoba lagi; masukkan ulang key bila perlu.",
        );
        inventory.retry();
      }
    });
  };
  return (
    <section
      className="provider-key-editor"
      aria-labelledby="provider-keys-heading"
    >
      <h2 id="provider-keys-heading">API key provider</h2>
      <p>
        Key tersimpan tidak ditampilkan kembali. Key dari UI diprioritaskan
        untuk permintaan AI berikutnya. Menyimpan key tidak menjalankan AI.
      </p>
      <Notice error={inventory.error} retry={inventory.retry} />
      {!inventory.loading &&
        inventory.data &&
        !inventory.data.storage_ready && (
          <div className="notice" role="status">
            Penyimpanan API key belum tersedia. Administrator server perlu
            menyiapkan enkripsi sebelum key dapat disimpan.
          </div>
        )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <fieldset className="editor-fields" disabled={action.busy}>
          <div className="form-grid">
            <label>
              Provider API key
              <select
                aria-label="Provider API key"
                value={provider}
                onChange={(event) => {
                  setProvider(event.target.value as KeyProvider);
                  setKey("");
                  setDraftVersion(undefined);
                  setShow(false);
                  setMessage("");
                  setError("");
                }}
              >
                {keyProviders.map((id) => (
                  <option key={id} value={id}>
                    {providerLabel(id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              API key baru
              <input
                type={show ? "text" : "password"}
                name="provider-api-key"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="none"
                value={key}
                maxLength={4096}
                disabled={!ready}
                aria-describedby="provider-key-help"
                onChange={(event) => {
                  if (!key) setDraftVersion(status?.version ?? null);
                  if (!event.target.value) setDraftVersion(undefined);
                  setKey(event.target.value);
                }}
                placeholder="Masukkan atau tempel key baru"
              />
            </label>
          </div>
          <p id="provider-key-help" className="muted">
            Input hanya untuk key baru. Setelah dikirim, input dikosongkan. Key
            tidak disimpan di penyimpanan browser.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={show}
              onChange={(event) => setShow(event.target.checked)}
              disabled={!ready}
            />
            Tampilkan key yang sedang diketik
          </label>
          <p className="credential-status" aria-label="Status API key">
            {inventory.loading
              ? "Memeriksa status key…"
              : !status || inventory.error
                ? "Status API key belum diketahui"
                : status?.source === "UI"
                  ? "Key tersimpan dari Admin"
                  : status?.source === "RUNTIME"
                    ? "Key tersedia dari konfigurasi server"
                    : status?.source === "LOCKED"
                      ? "Key tersimpan tetapi tidak dapat dibuka"
                      : "Belum ada API key"}
            {status?.updated_at
              ? ` · Diperbarui ${formatWib(status.updated_at)}`
              : ""}
          </p>
          <div className="credential-actions">
            <button type="submit" disabled={!ready || !valid}>
              {status?.version ? "Ganti API key" : "Simpan API key"}
            </button>
            <button
              type="button"
              disabled={!status?.version || !!inventory.error}
              onClick={() => void send(true)}
            >
              Hapus key dari UI
            </button>
            <button type="button" onClick={inventory.retry}>
              Muat ulang status key
            </button>
          </div>
        </fieldset>
      </form>
      <p>
        Cloudflare Workers AI memakai binding AI dan tidak memerlukan API key
        pada form ini.
      </p>
      <Notice error={error} />
      {message && <p role="status">{message}</p>}
    </section>
  );
}
