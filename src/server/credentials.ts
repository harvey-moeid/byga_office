import { z } from "zod";
import { providers } from "../core/contracts";
import {
  keyProviders,
  type CredentialInventory,
  type CredentialWrite,
  type KeyProvider,
} from "../core/credentials";
import type { Env } from "./env";
import { HttpError } from "./http";

export const providerKeyBindings = {
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  mistral: "MISTRAL_API_KEY",
  huggingface: "HF_TOKEN",
  cohere: "COHERE_API_KEY",
  nvidia: "NVIDIA_API_KEY",
} as const;
const envelopeSchema = z
  .object({ v: z.literal(1), iv: z.string(), data: z.string() })
  .strict();
interface CredentialRow {
  provider: KeyProvider;
  encrypted: string;
  version: string;
  updated_at: number;
}
const snapshots = new WeakMap<Env, CredentialInventory>();
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
async function masterKey(env: Env) {
  const root = env.PROVIDER_KEYS_ENCRYPTION_KEY;
  if (!root || !/^[a-f0-9]{64}$/i.test(root))
    throw new HttpError(
      503,
      "Penyimpanan API key belum siap. Administrator server perlu menyiapkan kunci enkripsi.",
      "CREDENTIAL_STORAGE_UNAVAILABLE",
    );
  return crypto.subtle.importKey(
    "raw",
    Uint8Array.from(root.match(/../g)!, (pair) => parseInt(pair, 16)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
const aad = (provider: KeyProvider, version: string) =>
  new TextEncoder().encode(`byga:provider-key:v1:${provider}:${version}`);
export async function sealCredential(
  env: Env,
  provider: KeyProvider,
  version: string,
  value: string,
) {
  const key = await masterKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(provider, version) },
    key,
    new TextEncoder().encode(value),
  );
  return JSON.stringify({
    v: 1,
    iv: encode(iv),
    data: encode(new Uint8Array(data)),
  });
}
export async function openCredential(env: Env, row: CredentialRow) {
  const envelope = envelopeSchema.parse(JSON.parse(row.encrypted));
  const iv = decode(envelope.iv);
  if (iv.length !== 12) throw new Error("Invalid credential envelope");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad(row.provider, row.version) },
    await masterKey(env),
    decode(envelope.data),
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(plain);
}

/** One short-lived snapshot per operation. Never attach plaintext keys to API payloads. */
export async function resolveProviderEnv(env: Env): Promise<Env> {
  if (snapshots.has(env) || !env.DB) return env;
  const rows = await env.DB.prepare(
    "SELECT provider,encrypted,version,updated_at FROM provider_credentials",
  ).all<CredentialRow>();
  const effective: Env = { ...env };
  let ready = false;
  try {
    await masterKey(env);
    ready = true;
  } catch {
    /* Runtime keys still work when the vault is unavailable. */
  }
  const statuses = new Map<
    KeyProvider,
    { readable: boolean; row: CredentialRow }
  >();
  for (const row of rows.results) {
    if (!keyProviders.includes(row.provider)) continue;
    const binding = providerKeyBindings[row.provider];
    // A saved override fails closed: never silently use a different runtime account.
    effective[binding] = undefined;
    let readable = false;
    if (ready) {
      try {
        effective[binding] = await openCredential(env, row);
        readable = !!effective[binding];
      } catch {
        /* Corruption/incorrect root keys are exposed only as LOCKED metadata. */
      }
    }
    statuses.set(row.provider, { readable, row });
  }
  const inventory: CredentialInventory = {
    storage_ready: ready,
    items: providers.map((id) => {
      if (id === "workers-ai")
        return {
          id,
          configured: typeof env.AI?.run === "function",
          source: typeof env.AI?.run === "function" ? "BINDING" : "MISSING",
          version: null,
          updated_at: null,
        };
      const stored = statuses.get(id);
      const configured =
        typeof effective[providerKeyBindings[id]] === "string" &&
        !!effective[providerKeyBindings[id]];
      return {
        id,
        configured,
        source: stored
          ? stored.readable
            ? "UI"
            : "LOCKED"
          : configured
            ? "RUNTIME"
            : "MISSING",
        version: stored?.row.version ?? null,
        updated_at: stored?.row.updated_at ?? null,
      };
    }),
  };
  snapshots.set(effective, inventory);
  return effective;
}
export async function credentialInventory(
  env: Env,
): Promise<CredentialInventory> {
  const effective = await resolveProviderEnv(env);
  return snapshots.get(effective)!;
}

export async function writeCredential(env: Env, body: CredentialWrite) {
  if (body.action === "DELETE") {
    const result = await env.DB.prepare(
      "DELETE FROM provider_credentials WHERE provider=? AND version=? RETURNING provider",
    )
      .bind(body.id, body.expectedVersion)
      .first();
    if (!result)
      throw new HttpError(
        409,
        "API key sudah berubah. Muat ulang status sebelum menghapus.",
        "CREDENTIAL_CONFLICT",
      );
    return;
  }
  const version = crypto.randomUUID();
  const encrypted = await sealCredential(env, body.id, version, body.key);
  const result =
    body.expectedVersion === null
      ? await env.DB.prepare(
          "INSERT INTO provider_credentials(provider,encrypted,version,updated_at) VALUES (?,?,?,?) ON CONFLICT(provider) DO NOTHING RETURNING provider",
        )
          .bind(body.id, encrypted, version, Date.now())
          .first()
      : await env.DB.prepare(
          "UPDATE provider_credentials SET encrypted=?,version=?,updated_at=? WHERE provider=? AND version=? RETURNING provider",
        )
          .bind(encrypted, version, Date.now(), body.id, body.expectedVersion)
          .first();
  if (!result)
    throw new HttpError(
      409,
      "API key sudah berubah. Muat ulang status sebelum menggantinya.",
      "CREDENTIAL_CONFLICT",
    );
}
