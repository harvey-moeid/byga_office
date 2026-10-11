import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { credentialWriteSchema } from "../src/core/credentials";
import { defaultCharacters } from "../src/core/contracts";
import {
  credentialInventory,
  openCredential,
  resolveProviderEnv,
  sealCredential,
  writeCredential,
} from "../src/server/credentials";
import {
  requestAI,
  discoverModels,
  isProviderConfigured,
  redact,
  runCharacter,
  defaultPolicy,
  type AIRuntime,
} from "../src/server/providers";
import type { Env } from "../src/server/env";
import { readFile } from "node:fs/promises";

let mf: Miniflare;
let env: Env;
const saved = "fixture-only-ui-provider-key-12345";
const runtime = "fixture-only-runtime-provider-key-67890";
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('fixture'); } }",
      d1Databases: ["DB"],
    }),
  );
  const db = await mf.getD1Database("DB");
  await db.exec(
    await readFile("migrations/0008_provider_credentials.sql", "utf8"),
  );
  env = {
    DB: db,
    PROVIDER_KEYS_ENCRYPTION_KEY: "a".repeat(64),
    OPENROUTER_API_KEY: runtime,
  } as Env;
});
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM provider_credentials").run();
});
afterAll(async () => {
  await mf?.dispose();
});
const save = (expectedVersion: string | null = null, key = saved) =>
  writeCredential(env, {
    id: "openrouter",
    action: "SAVE",
    key,
    expectedVersion,
  });
const status = async () =>
  (await credentialInventory(env)).items.find(
    (item) => item.id === "openrouter",
  )!;

describe("Encrypted provider credentials", () => {
  it("stores only ciphertext and metadata, protects provider/version with authenticated encryption", async () => {
    await save();
    const row = (await env.DB.prepare(
      "SELECT * FROM provider_credentials",
    ).first())!;
    expect(JSON.stringify(row)).not.toContain(saved);
    expect(JSON.stringify(row)).not.toContain(env.PROVIDER_KEYS_ENCRYPTION_KEY);
    expect(
      await openCredential(
        env,
        row as unknown as Parameters<typeof openCredential>[1],
      ),
    ).toBe(saved);
    const first = await sealCredential(
      env,
      "openrouter",
      String(row.version),
      saved,
    );
    expect(first).not.toBe(row.encrypted);
    await expect(
      openCredential(env, {
        ...row,
        provider: "gemini",
      } as unknown as Parameters<typeof openCredential>[1]),
    ).rejects.toThrow();
    await expect(
      openCredential(env, {
        ...row,
        version: crypto.randomUUID(),
      } as unknown as Parameters<typeof openCredential>[1]),
    ).rejects.toThrow();
    const metadata = await credentialInventory(env);
    expect(metadata.storage_ready).toBe(true);
    expect(await status()).toMatchObject({ source: "UI", configured: true });
    expect(JSON.stringify(metadata)).not.toContain(saved);
    expect(JSON.stringify(metadata)).not.toContain("encrypted");
    expect(JSON.stringify(metadata)).not.toContain(runtime);
  });
  it("uses UI keys for inference and discovery, masks echo responses, and restores runtime keys after delete", async () => {
    await save();
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Bearer ${saved}`,
      );
      return Response.json(
        init?.method === "POST"
          ? { choices: [{ message: { content: saved } }] }
          : { data: [{ id: saved }] },
      );
    });
    expect(
      await requestAI(
        env,
        "openrouter",
        "fixture/model",
        "fixture",
        defaultCharacters()[0],
        1000,
        fetcher,
      ),
    ).toMatchObject({ text: "[REDACTED]" });
    expect(await discoverModels(env, "openrouter", fetcher)).toEqual([
      "[REDACTED]",
    ]);
    const effective = await resolveProviderEnv(env);
    expect(isProviderConfigured(effective, "openrouter")).toBe(true);
    expect(redact(`Echo ${saved}`, effective)).not.toContain(saved);
    await writeCredential(env, {
      id: "openrouter",
      action: "DELETE",
      confirmed: true,
      expectedVersion: (await status()).version!,
    });
    expect((await resolveProviderEnv(env)).OPENROUTER_API_KEY).toBe(runtime);
    expect(await status()).toMatchObject({ source: "RUNTIME", version: null });
  });
  it("locks corrupted or undecryptable overrides instead of silently using the runtime account", async () => {
    await save();
    const wrongRoot = { ...env, PROVIDER_KEYS_ENCRYPTION_KEY: "b".repeat(64) };
    const locked = await resolveProviderEnv(wrongRoot);
    expect(locked.OPENROUTER_API_KEY).toBeUndefined();
    expect(
      (await credentialInventory(wrongRoot)).items.find(
        (item) => item.id === "openrouter",
      ),
    ).toMatchObject({ configured: false, source: "LOCKED" });
    await expect(
      requestAI(
        wrongRoot,
        "openrouter",
        "fixture",
        "fixture",
        defaultCharacters()[0],
        1000,
        vi.fn(),
      ),
    ).rejects.toThrow("PROVIDER_NOT_CONFIGURED");
    await env.DB.prepare("UPDATE provider_credentials SET encrypted=?")
      .bind('{"v":1,"iv":"broken","data":"broken"}')
      .run();
    expect((await resolveProviderEnv(env)).OPENROUTER_API_KEY).toBeUndefined();
  });
  it("rejects writes without a valid root; delete can recover a locked override", async () => {
    const noRoot = { ...env, PROVIDER_KEYS_ENCRYPTION_KEY: undefined };
    await expect(
      writeCredential(noRoot, {
        id: "openrouter",
        action: "SAVE",
        key: saved,
        expectedVersion: null,
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(await credentialInventory(noRoot)).toMatchObject({
      storage_ready: false,
    });
    expect((await resolveProviderEnv(noRoot)).OPENROUTER_API_KEY).toBe(runtime);
    await save();
    const version = (await status()).version!;
    await writeCredential(noRoot, {
      id: "openrouter",
      action: "DELETE",
      confirmed: true,
      expectedVersion: version,
    });
    expect((await resolveProviderEnv(noRoot)).OPENROUTER_API_KEY).toBe(runtime);
  });
  it("rejects stale edits/deletes and concurrent inserts with an atomic version precondition", async () => {
    const writes = await Promise.allSettled([save(), save()]);
    expect(
      writes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      writes.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const old = (await status()).version!;
    await save(old, "fixture-rotated-ui-key");
    await expect(save(old)).rejects.toMatchObject({ status: 409 });
    await expect(
      writeCredential(env, {
        id: "openrouter",
        action: "DELETE",
        confirmed: true,
        expectedVersion: old,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await resolveProviderEnv(env)).OPENROUTER_API_KEY).toBe(
      "fixture-rotated-ui-key",
    );
  });
  it("redacts keys with JSON or URL escaping before parsed AI output can be stored", async () => {
    const unusual = 'fixture-"quoted-key\\with/slash';
    await save(null, unusual);
    const effective = await resolveProviderEnv(env);
    const json = redact(JSON.stringify({ summary: unusual }), effective);
    expect(JSON.parse(json).summary).toBe("[REDACTED]");
    expect(redact(encodeURIComponent(unusual), effective)).toBe("[REDACTED]");
  });
  it("removes UI keys from provider exception messages retained in character results", async () => {
    await save();
    const character = {
      ...defaultCharacters()[0],
      primary_provider: "openrouter" as const,
      fallback_provider: "openrouter" as const,
    };
    const audit = vi.fn<AIRuntime["audit"]>(async () => {});
    const result = await runCharacter(
      env,
      character,
      {},
      {
        getCircuit: async () => ({ failures: 0, openedAt: 0 }),
        setCircuit: async () => {},
        audit,
        beforeCall: async () => {},
        policy: async () => ({ ...defaultPolicy, retries: 0 }),
      },
      vi.fn(async () => {
        throw new Error("Network rejected " + saved);
      }),
      async () => {},
    );
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.validationErrors).toContain("Network rejected [REDACTED]");
    expect(JSON.stringify({ result, audit: audit.mock.calls })).not.toContain(
      saved,
    );
  });
  it("rejects Workers AI, oversized/multiline keys, unknown fields, and unconfirmed deletes", () => {
    for (const body of [
      { id: "workers-ai", action: "SAVE", key: saved, expectedVersion: null },
      { id: "openrouter", action: "SAVE", key: "short", expectedVersion: null },
      {
        id: "openrouter",
        action: "SAVE",
        key: "a".repeat(4097),
        expectedVersion: null,
      },
      {
        id: "openrouter",
        action: "SAVE",
        key: "fixture-key\nsecond-line",
        expectedVersion: null,
      },
      {
        id: "openrouter",
        action: "SAVE",
        key: saved,
        expectedVersion: null,
        extra: true,
      },
      {
        id: "openrouter",
        action: "DELETE",
        confirmed: false,
        expectedVersion: crypto.randomUUID(),
      },
    ])
      expect(credentialWriteSchema.safeParse(body).success).toBe(false);
  });
});
