import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import {
  analysisGroups,
  analysisSchema,
  characterIds,
  characterSchema,
  configSchema,
  defaultCharacters,
  workersAIModel,
  defaultConfig,
  MARKET,
  providers,
  wibDate,
  type AnalystResult,
  type CharacterConfig,
  type Direction,
  type GroupSnapshot,
  type MarketContext,
  type ScannerOutput,
  type Signal,
  type TradeDirection,
  type TradingConfig,
} from "../core/contracts";
import {
  analyzeGroups,
  analystGroup,
  bias,
  buildContext,
  buildGroupContext,
  composition,
  confidence,
  fallbackDirection,
  groupComposition,
  groupTrigger,
  indicators,
  risk,
  scan,
  voting,
} from "../core/engine";
import { digest, json } from "./auth";
import { configWriteSchema, type ConfigWriteResult } from "../core/api";
import {
  errorResponse,
  HttpError,
  methodNotAllowed,
  readJsonObject,
} from "./http";
import type { Env } from "./env";
import { chartSchema, readDerivatives, readMarket } from "./market";
import {
  circuitResult,
  characterSemanticErrors,
  circuitState,
  defaultPolicy,
  discoverModels,
  parseOutput,
  requestAI,
  redact,
  runCharacter,
  type AIRuntime,
  type Circuit,
  type ProviderPolicy,
} from "./providers";
import { notify, retryDeliveries } from "./discord";
interface CaseContext {
  market: MarketContext;
  scanners: ScannerOutput[];
  groups?: GroupSnapshot[];
  config: TradingConfig;
  characters: CharacterConfig[];
  sendDiscord: boolean;
  focus: Direction;
  context_compressed: boolean;
  tick_size: number;
  market_read_at?: number;
  strict_replay?: boolean;
  request?: unknown;
}
export interface CaseRow {
  uuid: string;
  id: string;
  mode: "LIVE" | "SIMULATION";
  source: "AUTO" | "EMERGENCY" | "SIMULATION";
  direction: TradeDirection | null;
  status: string;
  candle_timestamp: number;
  config_version: string;
  context: string;
  result: string | null;
  created_at: number;
  updated_at: number;
  idempotency_key: string;
}
const emergencySchema = z.object({
  focus: z.enum(["BUY", "SELL", "NONE"]).default("NONE"),
  sendDiscord: z.boolean().default(false),
  idempotencyKey: z.string().min(8).max(100),
});
const simulationSchema = z.object({
  timestamp: z.number().int().positive(),
  configMode: z.enum(["CURRENT", "HISTORICAL"]),
  configVersion: z.string().optional(),
  replayMode: z.enum(["STRICT", "COMPATIBLE"]),
  historicalCaseId: z.string().optional(),
  idempotencyKey: z.string().min(8).max(100),
});
export class Office extends DurableObject<Env> {
  private queue: Promise<unknown> = Promise.resolve();
  private alarmTask?: Promise<void>;
  private readonly mode: CaseRow["mode"];
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Durable Object identity, not mutable storage, owns the queue partition.
    if (ctx.id.equals(env.OFFICE.idFromName(`${MARKET}:simulation`)))
      this.mode = "SIMULATION";
    else if (ctx.id.equals(env.OFFICE.idFromName(MARKET))) this.mode = "LIVE";
    else throw new Error("Unknown office actor identity");
    ctx.blockConcurrencyWhile(async () => {
      if (!(await ctx.storage.get("initialized"))) {
        await env.DB.prepare(
          "INSERT OR IGNORE INTO trading_config_versions VALUES (?,?,?,?)",
        )
          .bind(
            "TRADING-CONFIG-v1",
            1,
            JSON.stringify(defaultConfig),
            Date.now(),
          )
          .run();
        await env.DB.prepare(
          "INSERT OR IGNORE INTO system_state VALUES ('active_config','TRADING-CONFIG-v1')",
        ).run();
        await ctx.storage.put("initialized", true);
      }
      for (const c of defaultCharacters()) {
        await env.DB.batch([
          env.DB.prepare(
            "INSERT OR IGNORE INTO character_configs VALUES (?,?)",
          ).bind(c.id, JSON.stringify(c)),
          env.DB.prepare(
            "INSERT OR IGNORE INTO prompt_versions VALUES (?,?,?,?)",
          ).bind(c.prompt_version, c.id, JSON.stringify(c), Date.now()),
        ]);
      }
      const queued = await env.DB.prepare(
        "SELECT uuid FROM cases WHERE mode=? AND status='QUEUED' LIMIT 1",
      )
        .bind(this.mode)
        .first();
      if (queued && !(await ctx.storage.getAlarm()))
        await ctx.storage.setAlarm(Date.now() + 1000);
    });
  }
  private async config(version?: string) {
    const id =
      version ??
      (await this.env.DB.prepare(
        "SELECT value FROM system_state WHERE key='active_config'",
      ).first<{ value: string }>())!.value;
    const row = await this.env.DB.prepare(
      "SELECT snapshot FROM trading_config_versions WHERE id=?",
    )
      .bind(id)
      .first<{ snapshot: string }>();
    if (!row) throw new Error("Config version not found");
    return { id, config: configSchema.parse(JSON.parse(row.snapshot)) };
  }
  private async characters() {
    const rows = await this.env.DB.prepare(
      "SELECT snapshot FROM character_configs",
    ).all<{ snapshot: string }>();
    const byId = new Map(
      rows.results.map((row) => {
        const character = characterSchema.parse(JSON.parse(row.snapshot));
        return [character.id, character] as const;
      }),
    );
    return characterIds.map((id) => {
      const character = byId.get(id);
      if (!character) throw new Error(`Character config missing: ${id}`);
      return character;
    });
  }
  private async marketData(config: TradingConfig, at = Date.now()) {
    const delay = config.processingDelaySeconds * 1000;
    const count = Math.max(
      260,
      ...config.scanner.ema,
      config.context.H1,
      config.context.M15,
      config.context.M5,
    );
    const [market, derivatives] = await Promise.all([
      readMarket(this.env, at, count, delay),
      readDerivatives(this.env, at, 24, delay),
    ]);
    return { market, derivatives };
  }
  private async id(prefix: "CASE" | "SIG") {
    const day = wibDate();
    const allocated = await this.env.DB.prepare(
      "INSERT INTO sequences(prefix,day,value) VALUES (?,?,1) ON CONFLICT(prefix,day) DO UPDATE SET value=value+1 RETURNING value",
    )
      .bind(prefix, day)
      .first<{ value: number }>();
    const sequence = allocated!.value;
    return `${prefix}-${day}-${String(sequence).padStart(4, "0")}`;
  }
  async fetch(request: Request): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      // External diagnostics must never own the business mutation queue while
      // awaiting a provider. Snapshot reads remain available during all writes.
      if (
        (request.method === "GET" &&
          [
            "/state",
            "/config",
            "/characters",
            "/providers",
            "/prompts",
            "/diagnostics",
          ].includes(path)) ||
        ["/models", "/test-provider"].includes(path)
      )
        return await this.route(request);
      return await this.serial(() => this.route(request));
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Daily AI case budget reached"
      )
        return json({ error: error.message, code: "CASE_BUDGET_REACHED" }, 400);
      return errorResponse(error);
    }
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action, action);
    this.queue = next.catch(() => {});
    return next;
  }
  private async route(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (
      (path === "/simulation" && this.mode !== "SIMULATION") ||
      ([
        "/tick",
        "/schedule",
        "/emergency",
        "/config",
        "/characters",
        "/rollback",
      ].includes(path) &&
        (request.method !== "GET" ||
          ["/tick", "/schedule", "/emergency"].includes(path)) &&
        this.mode !== "LIVE")
    )
      return json({ error: "Operation belongs to another office actor" }, 409);
    if (path === "/wake") {
      await this.scheduleAlarm(Date.now() + 1000);
      return json({ ok: true });
    }
    if (path === "/tick") {
      if (request.method !== "POST") return methodNotAllowed(["POST"]);
      await this.tick();
      return json({ ok: true });
    }
    if (path === "/schedule") {
      const { scheduledTime } = z
        .object({ scheduledTime: z.number().int().nonnegative() })
        .parse(await request.json());
      const { config } = await this.config();
      const due = Math.max(
        Date.now() + 1,
        scheduledTime + config.processingDelaySeconds * 1000,
      );
      const pending = await this.ctx.storage.get<number>("pending_tick");
      // Retain the earliest unconsumed event when cron delivery is repeated.
      await this.ctx.storage.put(
        "pending_tick",
        Math.min(pending ?? Infinity, due),
      );
      const currentAlarm = await this.ctx.storage.getAlarm();
      await this.scheduleAlarm(Math.min(currentAlarm ?? Infinity, due));
      return json({ ok: true, scan_after: due });
    }
    if (path === "/state") {
      const observed_at = Date.now();
      const { config } = await this.config();
      const active = await this.env.DB.prepare(
        "SELECT id,status FROM cases WHERE mode='LIVE' AND status IN ('REVALIDATING','AI_ANALYSIS','AI_DEGRADED','RISK_REVIEW','BOSS_REVIEW','SIGNAL_CREATED') ORDER BY created_at LIMIT 1",
      ).first();
      return json({
        observed_at,
        scanner_consensus_min: config.scannerConsensusMin,
        group_names: analysisGroups,
        group_consensus_min: config.scannerConsensusMin,
        groups: (await this.ctx.storage.get("groups")) ?? [],
        office: (await this.ctx.storage.get("office")) ?? "MONITORING",
        active,
        scanners: (await this.ctx.storage.get("scanners")) ?? [],
        last_processed_candle: await this.ctx.storage.get(
          "last_processed_candle",
        ),
        error: (await this.ctx.storage.get("market_error"))
          ? "MARKET_UNAVAILABLE"
          : null,
      });
    }
    if (path === "/diagnostics" && request.method === "GET")
      return json({
        market_error: (await this.ctx.storage.get("market_error")) ?? null,
      });
    if (path === "/config" && request.method === "GET") {
      const active = await this.config();
      const versions = await this.env.DB.prepare(
        "SELECT id,created_at FROM trading_config_versions ORDER BY version DESC LIMIT 100",
      ).all();
      return json({ ...active, versions: versions.results });
    }
    if (path === "/config") {
      const body = configWriteSchema.parse(await readJsonObject(request));
      if (body.activation === "APPLY NOW" && !body.confirmed)
        return json({ error: "APPLY NOW requires confirmation" }, 409);
      const key = `config:${body.idempotencyKey ?? crypto.randomUUID()}`;
      const payloadHash = await digest(JSON.stringify(body));
      const receipt = await this.env.DB.prepare(
        "SELECT payload_hash,response FROM admin_operations WHERE key=?",
      )
        .bind(key)
        .first<{ payload_hash: string; response: string }>();
      if (receipt) {
        if (receipt.payload_hash !== payloadHash)
          throw new HttpError(
            409,
            "Idempotency key belongs to a different request",
            "IDEMPOTENCY_CONFLICT",
          );
        await this.wakeCommitted();
        return json(JSON.parse(receipt.response));
      }
      const current = await this.config();
      if (body.expectedVersion && body.expectedVersion !== current.id)
        throw new HttpError(
          409,
          "Configuration changed. Review the latest version before saving.",
          "CONFIG_CONFLICT",
        );
      const v =
        (await this.env.DB.prepare(
          "SELECT MAX(version) AS version FROM trading_config_versions",
        ).first<{ version: number }>())!.version + 1;
      const id = `TRADING-CONFIG-v${v}`;
      let old: CaseRow | null = null,
        replacement: CaseRow | undefined;
      if (body.activation === "APPLY NOW") {
        old = await this.env.DB.prepare(
          "SELECT * FROM cases WHERE mode='LIVE' AND status IN ('QUEUED','REVALIDATING','AI_ANALYSIS','AI_DEGRADED','RISK_REVIEW','BOSS_REVIEW') ORDER BY created_at LIMIT 1",
        ).first<CaseRow>();
        if (old) {
          const { market, derivatives } = await this.marketData(body.config);
          const scanners = scan(market, body.config, id);
          const groups = analyzeGroups(
            market,
            scanners,
            body.config,
            id,
            Date.now(),
            derivatives,
          );
          replacement = await this.prepareCase(
            market,
            scanners,
            groups,
            body.config,
            id,
            old.mode,
            old.source,
            groupTrigger(groups, body.config.scannerConsensusMin),
            `config:${old.uuid}:${id}`,
            false,
            "NONE",
          );
          if (!(await this.budgetAvailable(replacement, body.config)))
            throw new HttpError(
              400,
              "Daily AI case budget reached",
              "CASE_BUDGET_REACHED",
            );
        }
      }
      const now = Date.now();
      const result: ConfigWriteResult = {
        id,
        replacement_case_id: replacement?.id ?? null,
      };
      const quota = replacement
        ? this.quota(replacement, body.config)
        : { liveLimit: 0, sourceLimit: 0, dayStart: 0 };
      const batch = [
        this.env.DB.prepare(
          "INSERT INTO trading_config_versions VALUES (?,?,?,?)",
        ).bind(id, v, JSON.stringify(body.config), now),
        this.env.DB.prepare(
          `INSERT INTO admin_operations(key,payload_hash,response,created_at,guard)
          SELECT ?,?,?,?,CASE WHEN
            (SELECT value FROM system_state WHERE key='active_config')=?
            AND (? IS NULL OR EXISTS (SELECT 1 FROM cases WHERE uuid=? AND status IN ('QUEUED','REVALIDATING','AI_ANALYSIS','AI_DEGRADED','RISK_REVIEW','BOSS_REVIEW')))
            AND (?=0 OR (SELECT COUNT(*) FROM cases WHERE mode='LIVE' AND created_at>=?)<?)
            AND (?=0 OR (SELECT COUNT(*) FROM cases WHERE source=? AND created_at>=?)<?)
          THEN 1 ELSE 0 END`,
        ).bind(
          key,
          payloadHash,
          JSON.stringify(result),
          now,
          current.id,
          old?.uuid ?? null,
          old?.uuid ?? null,
          quota.liveLimit,
          quota.dayStart,
          quota.liveLimit,
          quota.sourceLimit,
          replacement?.source ?? "AUTO",
          quota.dayStart,
          quota.sourceLimit,
        ),
        this.env.DB.prepare(
          "UPDATE system_state SET value=? WHERE key='active_config'",
        ).bind(id),
      ];
      if (replacement && old)
        batch.push(
          this.env.DB.prepare(
            "INSERT INTO cases VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
          ).bind(...Object.values(replacement)),
          this.env.DB.prepare(
            "INSERT INTO case_events(case_uuid,status,created_at) VALUES (?,?,?)",
          ).bind(replacement.uuid, "QUEUED", now),
          this.env.DB.prepare(
            "UPDATE cases SET status='CONFIG_CHANGED',updated_at=? WHERE uuid=?",
          ).bind(now, old.uuid),
          this.env.DB.prepare(
            "INSERT INTO case_events(case_uuid,status,created_at) VALUES (?,?,?)",
          ).bind(old.uuid, "CONFIG_CHANGED", now),
        );
      try {
        await this.env.DB.batch(batch);
      } catch (error) {
        if (
          error instanceof Error &&
          /CHECK constraint failed.*guard/.test(error.message)
        )
          throw new HttpError(
            409,
            "Configuration, case or quota changed. Refresh and review before saving.",
            "CONFIG_CONFLICT",
          );
        throw error;
      }
      if (replacement) await this.wakeCommitted();
      return json(result);
    }
    if (path === "/characters" && request.method === "GET")
      return json(await this.characters());
    if (path === "/characters") {
      const c = characterSchema.parse(await readJsonObject(request));
      const version = `${c.id}-${crypto.randomUUID()}`;
      c.prompt_version = version;
      await this.env.DB.batch([
        this.env.DB.prepare(
          "INSERT INTO prompt_versions VALUES (?,?,?,?)",
        ).bind(version, c.id, JSON.stringify(c), Date.now()),
        this.env.DB.prepare(
          "UPDATE character_configs SET snapshot=? WHERE id=?",
        ).bind(JSON.stringify(c), c.id),
      ]);
      return json(c);
    }
    if (path === "/prompts") {
      const rows = await this.env.DB.prepare(
        "SELECT * FROM prompt_versions ORDER BY created_at DESC LIMIT 100",
      ).all();
      return json(rows.results);
    }
    if (path === "/rollback") {
      const { id } = z
        .object({ id: z.string() })
        .parse(await readJsonObject(request));
      const row = await this.env.DB.prepare(
        "SELECT character_id,snapshot FROM prompt_versions WHERE id=?",
      )
        .bind(id)
        .first<{ character_id: string; snapshot: string }>();
      if (!row) return json({ error: "Prompt version not found" }, 404);
      await this.env.DB.prepare(
        "UPDATE character_configs SET snapshot=? WHERE id=?",
      )
        .bind(row.snapshot, row.character_id)
        .run();
      return json({ ok: true });
    }
    if (path === "/providers" && request.method === "POST") {
      const body = z
        .object({
          id: z.enum(providers),
          policy: z.object({
            retries: z.number().int().min(0).max(3),
            jitter: z.boolean(),
            threshold: z.number().int().min(1).max(20),
            cooldownMs: z.number().int().min(1000).max(3600000),
          }),
        })
        .parse(await readJsonObject(request));
      await this.env.DB.prepare(
        "INSERT OR REPLACE INTO provider_configs VALUES (?,?)",
      )
        .bind(body.id, JSON.stringify(body.policy))
        .run();
      return json({ ok: true });
    }
    if (path === "/providers") {
      const result = await Promise.all(
        providers.map(async (id) => {
          const c = (await this.ctx.storage.get<Circuit>(`circuit:${id}`)) ?? {
            failures: 0,
            openedAt: 0,
          };
          const policy = await this.policy(id);
          return {
            id,
            state: circuitState(c, Date.now(), policy.cooldownMs),
            ...c,
            policy,
          };
        }),
      );
      return json(result);
    }
    if (path === "/models" || path === "/test-provider") {
      const { id } = z
        .object({ id: z.enum(providers) })
        .parse(await readJsonObject(request));
      try {
        const cache = await this.ctx.storage.get<{
          at: number;
          models: string[];
        }>(`models:${id}`);
        const models =
          path === "/test-provider" && id === "workers-ai"
            ? [workersAIModel]
            : path === "/models" && cache && Date.now() - cache.at < 3600000
              ? cache.models
              : await discoverModels(this.env, id);
        let inference: "PASS" | undefined;
        if (path === "/test-provider" && id === "workers-ai") {
          const response = await requestAI(
            this.env,
            id,
            workersAIModel,
            "Synthetic connection test only. Return JSON: vote BUY, confidence 0, summary Connectivity verified, reasoning Synthetic probe only, evidence [], risk_flags [CONNECTIVITY_TEST], price_levels null. Do not analyze markets or create a trading signal.",
            {
              ...defaultCharacters()[0],
              temperature: 0,
              max_output_tokens: 512,
            },
            10000,
          );
          const output = parseOutput(response.text);
          if (
            output.vote !== "BUY" ||
            !output.risk_flags.includes("CONNECTIVITY_TEST")
          )
            throw new Error("WORKERS_AI_PROBE_INVALID");
          inference = "PASS";
        }
        await this.serial(async () => {
          await this.ctx.storage.put(`models:${id}`, {
            at: Date.now(),
            models,
          });
          if (path === "/test-provider")
            await this.ctx.storage.put(`circuit:${id}`, {
              failures: 0,
              openedAt: 0,
            });
        });
        return json({
          models,
          ok: true,
          ...(inference ? { inference, model: workersAIModel } : {}),
        });
      } catch (error) {
        return json(
          {
            error:
              error instanceof Error ? error.message : "Provider unavailable",
          },
          503,
        );
      }
    }
    if (path === "/emergency") {
      const body = emergencySchema.parse(await readJsonObject(request));
      const repeated = await this.repeatCase(
        `emergency:${body.idempotencyKey}`,
        body,
      );
      if (repeated) return json(repeated, 202);
      const { id, config } = await this.config();
      const { market, derivatives } = await this.marketData(config);
      const scanners = scan(market, config, id);
      const groups = analyzeGroups(
        market,
        scanners,
        config,
        id,
        Date.now(),
        derivatives,
      );
      const item = await this.createCase(
        market,
        scanners,
        groups,
        config,
        id,
        "LIVE",
        "EMERGENCY",
        groupTrigger(groups, config.scannerConsensusMin),
        `emergency:${body.idempotencyKey}`,
        body.sendDiscord,
        body.focus,
        undefined,
        false,
        body,
      );
      return json(item, 202);
    }
    if (path === "/simulation") {
      const body = simulationSchema.parse(await readJsonObject(request));
      const repeated = await this.repeatCase(
        `simulation:${body.idempotencyKey}`,
        body,
      );
      if (repeated) return json(repeated, 202);
      if (body.timestamp > Date.now())
        return json(
          { error: "Simulation requires a historical timestamp" },
          400,
        );
      const { id, config } = await this.config(
        body.configMode === "HISTORICAL" ? body.configVersion : undefined,
      );
      if (body.configMode === "HISTORICAL" && !body.configVersion)
        return json({ error: "Historical config version required" }, 400);
      const { market, derivatives } = await this.marketData(
        config,
        body.timestamp,
      );
      const scanners = scan(market, config, id, body.timestamp);
      const groups = analyzeGroups(
        market,
        scanners,
        config,
        id,
        body.timestamp,
        derivatives,
      );
      let historical: CharacterConfig[] | undefined;
      if (body.replayMode === "STRICT") {
        if (!body.historicalCaseId)
          return json(
            { error: "STRICT replay requires a historical case" },
            400,
          );
        const row = await this.env.DB.prepare(
          "SELECT uuid,context FROM cases WHERE id=?",
        )
          .bind(body.historicalCaseId)
          .first<{ uuid: string; context: string }>();
        if (!row)
          return json({ error: "Historical AI snapshot not found" }, 404);
        historical = (JSON.parse(row.context) as CaseContext).characters;
        const outputs = await this.env.DB.prepare(
          "SELECT snapshot FROM ai_character_outputs WHERE case_uuid=?",
        )
          .bind(row.uuid)
          .all<{ snapshot: string }>();
        const identities = outputs.results.map(
          (r) => JSON.parse(r.snapshot) as AnalystResult,
        );
        historical = historical.map((c) => {
          const used = identities.find((a) => a.id === c.id);
          if (!used?.provider || !used.model || used.status !== "SUCCESS")
            throw new Error(`Historical AI identity unavailable: ${c.id}`);
          return {
            ...c,
            primary_provider: used.provider,
            primary_model: used.model,
            fallback_provider: used.provider,
            fallback_model: used.model,
          };
        });
      }
      const item = await this.createCase(
        market,
        scanners,
        groups,
        config,
        id,
        "SIMULATION",
        "SIMULATION",
        groupTrigger(groups, config.scannerConsensusMin),
        `simulation:${body.idempotencyKey}`,
        false,
        "NONE",
        historical,
        body.replayMode === "STRICT",
        body,
      );
      return json(item, 202);
    }
    return json({ error: "Unknown action" }, 404);
  }
  private async tick() {
    // An idle office still needs scheduled retention and outbox maintenance.
    if ((await this.ctx.storage.getAlarm()) === null)
      await this.scheduleAlarm(Date.now() + 1000);
    await retryDeliveries(this.env);
    const { id, config } = await this.config();
    try {
      const { market, derivatives } = await this.marketData(config);
      await this.ctx.storage.delete("market_error");
      const candle = market.M5.at(-1)!.timestamp;
      if (candle === (await this.ctx.storage.get("last_processed_candle")))
        return;
      const scanners = scan(market, config, id);
      const groups = analyzeGroups(
        market,
        scanners,
        config,
        id,
        Date.now(),
        derivatives,
      );
      await this.ctx.storage.put("scanners", scanners);
      await this.ctx.storage.put("groups", groups);
      const run = crypto.randomUUID();
      await this.env.DB.batch([
        this.env.DB.prepare(
          "INSERT OR IGNORE INTO scanner_runs VALUES (?,?,?,?,?)",
        ).bind(run, candle, id, "LIVE", Date.now()),
        ...scanners.map((s) =>
          this.env.DB.prepare(
            "INSERT OR IGNORE INTO scanner_outputs SELECT uuid,?,? FROM scanner_runs WHERE candle_timestamp=? AND config_version=? AND mode=?",
          ).bind(s.name, JSON.stringify(s), candle, id, "LIVE"),
        ),
      ]);
      const direction = groupTrigger(groups, config.scannerConsensusMin);
      if (direction) {
        const { time: last } = await this.cooldownAnchor(config, direction);
        if (Date.now() - last >= config.cooldownMinutes * 60000) {
          await this.createCase(
            market,
            scanners,
            groups,
            config,
            id,
            "LIVE",
            "AUTO",
            direction,
            `${MARKET}:${candle}:LIVE`,
            true,
            "NONE",
          );
          if (!(await this.ctx.storage.get("active")))
            await this.ctx.storage.put("office", "TRIGGERED");
        }
      } else if (!(await this.ctx.storage.get("active")))
        await this.ctx.storage.put(
          "office",
          scanners.some((s) => s.direction !== "NONE")
            ? "WATCHING"
            : "MONITORING",
        );
      await this.ctx.storage.put("last_processed_candle", candle);
      await this.scheduleAlarm(Date.now() + 1000);
    } catch (error) {
      await this.ctx.storage.put(
        "market_error",
        error instanceof Error ? error.message : "Market unavailable",
      );
    }
  }
  private async repeatCase(key: string, request: unknown) {
    const existing = await this.env.DB.prepare(
      "SELECT * FROM cases WHERE idempotency_key=?",
    )
      .bind(key)
      .first<CaseRow>();
    if (!existing) return null;
    const saved = JSON.parse(existing.context) as CaseContext;
    if (
      saved.request &&
      JSON.stringify(saved.request) !== JSON.stringify(request)
    )
      throw new HttpError(
        409,
        "Idempotency key belongs to a different request",
        "IDEMPOTENCY_CONFLICT",
      );
    await this.wakeCommitted();
    return existing;
  }
  private async wakeCommitted() {
    try {
      await this.scheduleAlarm(Date.now() + 1000);
    } catch (error) {
      // D1 already committed. Report the accepted operation; a retry, the next
      // cron tick or actor reconstruction restores the queue wake-up.
      console.error(
        "office_wake_failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  private quota(row: CaseRow, config: TradingConfig) {
    const day = wibDate(row.created_at);
    return {
      dayStart: Date.parse(
        `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T00:00:00+07:00`,
      ),
      liveLimit: row.mode === "LIVE" ? config.budgets.casesPerDay : 0,
      sourceLimit:
        row.source === "EMERGENCY"
          ? config.budgets.emergenciesPerDay
          : row.source === "SIMULATION"
            ? config.budgets.simulationsPerDay
            : 0,
    };
  }
  private async budgetAvailable(row: CaseRow, config: TradingConfig) {
    const { liveLimit, sourceLimit, dayStart } = this.quota(row, config);
    const available = await this.env.DB.prepare(
      "SELECT (?=0 OR (SELECT COUNT(*) FROM cases WHERE mode='LIVE' AND created_at>=?)<?) AND (?=0 OR (SELECT COUNT(*) FROM cases WHERE source=? AND created_at>=?)<?) AS available",
    )
      .bind(
        liveLimit,
        dayStart,
        liveLimit,
        sourceLimit,
        row.source,
        dayStart,
        sourceLimit,
      )
      .first<{ available: number }>();
    return !!available?.available;
  }
  private async prepareCase(
    market: MarketContext,
    scanners: ScannerOutput[],
    groups: GroupSnapshot[],
    config: TradingConfig,
    version: string,
    mode: CaseRow["mode"],
    source: CaseRow["source"],
    direction: TradeDirection | null,
    key: string,
    sendDiscord: boolean,
    focus: Direction,
    characters?: CharacterConfig[],
    strictReplay = false,
    request?: unknown,
  ) {
    const context: CaseContext = {
      market,
      scanners,
      groups,
      config,
      characters: characters ?? (await this.characters()),
      sendDiscord,
      focus,
      strict_replay: strictReplay,
      request,
      market_read_at: Date.now(),
      tick_size:
        chartSchema.parse(JSON.parse(this.env.CHART_SCHEMA)).tickSize ?? 0.01,
      context_compressed: buildContext(market, scanners, config)
        .context_compressed,
    };
    const now = Date.now();
    const row: CaseRow = {
      uuid: crypto.randomUUID(),
      id: await this.id("CASE"),
      mode,
      source,
      direction,
      status: "QUEUED",
      candle_timestamp: market.M5.at(-1)!.timestamp,
      config_version: version,
      context: JSON.stringify(context),
      result: null,
      created_at: now,
      updated_at: now,
      idempotency_key: key,
    };
    return row;
  }
  private async createCase(...args: Parameters<Office["prepareCase"]>) {
    const [, , , config, , mode, source, direction, key] = args;
    const existing = await this.env.DB.prepare(
      "SELECT * FROM cases WHERE idempotency_key=?",
    )
      .bind(key)
      .first<CaseRow>();
    if (existing) return existing;
    const row = await this.prepareCase(...args);
    const { dayStart, liveLimit, sourceLimit } = this.quota(row, config);
    const batch = [
      this.env.DB.prepare(
        "INSERT OR IGNORE INTO cases SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (?=0 OR (SELECT COUNT(*) FROM cases WHERE mode='LIVE' AND created_at>=?)<?) AND (?=0 OR (SELECT COUNT(*) FROM cases WHERE source=? AND created_at>=?)<?)",
      ).bind(
        ...Object.values(row),
        liveLimit,
        dayStart,
        liveLimit,
        sourceLimit,
        source,
        dayStart,
        sourceLimit,
      ),
      this.env.DB.prepare(
        "INSERT INTO case_events(case_uuid,status,created_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM cases WHERE uuid=?)",
      ).bind(row.uuid, "QUEUED", row.created_at, row.uuid),
    ];
    if (row.mode === "SIMULATION" && args[13]) {
      const request = simulationSchema.parse(args[13]);
      batch.push(
        this.env.DB.prepare(
          "INSERT INTO simulation_runs SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM cases WHERE uuid=?)",
        ).bind(
          crypto.randomUUID(),
          row.uuid,
          request.replayMode,
          request.configMode,
          row.created_at,
          row.uuid,
        ),
      );
    }
    const [inserted] = await this.env.DB.batch(batch);
    if (!inserted.meta.changes) {
      const duplicate = await this.env.DB.prepare(
        "SELECT * FROM cases WHERE idempotency_key=?",
      )
        .bind(key)
        .first<CaseRow>();
      if (duplicate) return duplicate;
      throw new Error("Daily AI case budget reached");
    }
    if (
      mode === "LIVE" &&
      source === "AUTO" &&
      direction &&
      config.cooldownAnchor === "FROM_TRIGGER"
    )
      await this.ctx.storage.put(`cooldown:${direction}`, row.created_at);
    await this.wakeCommitted();
    return row;
  }
  private async status(row: CaseRow, status: string, result?: unknown) {
    row.status = status;
    row.updated_at = Date.now();
    const changed = await this.env.DB.prepare(
      "UPDATE cases SET status=?,updated_at=?,result=COALESCE(?,result) WHERE uuid=? AND status NOT IN ('CONFIG_CHANGED','CANCELLED')",
    )
      .bind(
        status,
        row.updated_at,
        result === undefined ? null : JSON.stringify(result),
        row.uuid,
      )
      .run();
    if (!changed.meta.changes)
      throw new Error("Case cancelled by configuration change");
    await this.env.DB.prepare(
      "INSERT INTO case_events(case_uuid,status,created_at) VALUES (?,?,?)",
    )
      .bind(row.uuid, status, row.updated_at)
      .run();
    if (row.mode === "LIVE")
      await this.ctx.storage.put(
        "office",
        status === "BOSS_REVIEW" ? "BOSS_DECISION" : status,
      );
  }
  async alarm() {
    // Automatic alarms and a concurrent wake-up must share one in-flight job.
    if (this.alarmTask) return this.alarmTask;
    const task = this.processAlarm();
    this.alarmTask = task;
    try {
      await task;
    } finally {
      if (this.alarmTask === task) this.alarmTask = undefined;
    }
  }
  private async scheduleAlarm(time: number) {
    // A watchdog, idle cleanup or queue wake-up must not postpone a pending scan.
    const pending = await this.ctx.storage.get<number>("pending_tick");
    await this.ctx.storage.setAlarm(
      Math.max(Date.now() + 1, Math.min(time, pending ?? Infinity)),
    );
  }
  private async cooldownAnchor(
    config: TradingConfig,
    direction: TradeDirection,
  ) {
    // D1 is authoritative across a crash between case/signal commit and the
    // storage update. The storage anchor alone cannot cover that write gap.
    const anchor =
      config.cooldownAnchor === "FROM_TRIGGER"
        ? await this.env.DB.prepare(
            "SELECT uuid,created_at AS time FROM cases WHERE mode='LIVE' AND source='AUTO' AND direction=? ORDER BY created_at DESC,id DESC LIMIT 1",
          )
            .bind(direction)
            .first<{ uuid: string; time: number }>()
        : await this.env.DB.prepare(
            "SELECT MAX(time) AS time FROM (SELECT created_at AS time FROM signals WHERE direction=? UNION ALL SELECT updated_at AS time FROM cases WHERE mode='LIVE' AND source='AUTO' AND direction=? AND status='NO_CONSENSUS')",
          )
            .bind(direction, direction)
            .first<{ time: number | null }>();
    const time = Math.max(
      anchor?.time ?? 0,
      (await this.ctx.storage.get<number>(`cooldown:${direction}`)) ?? 0,
    );
    return {
      time,
      triggerCase: anchor && "uuid" in anchor ? anchor.uuid : null,
    };
  }
  private async automaticBlockReason(
    row: CaseRow,
    config: TradingConfig,
    direction: TradeDirection,
    candle: number,
  ): Promise<string | null> {
    const { time: last, triggerCase } = await this.cooldownAnchor(
      config,
      direction,
    );
    const ownTrigger =
      config.cooldownAnchor === "FROM_TRIGGER" &&
      triggerCase === row.uuid &&
      last === row.created_at;
    if (!ownTrigger && Date.now() - last < config.cooldownMinutes * 60000)
      return "AUTO_COOLDOWN_ACTIVE";
    const duplicate = await this.env.DB.prepare(
      "SELECT c.uuid FROM cases c WHERE c.mode='LIVE' AND c.source='AUTO' AND c.config_version=? AND c.candle_timestamp=? AND c.uuid!=? AND ((c.direction=? AND c.status IN ('AI_ANALYSIS','AI_DEGRADED','RISK_REVIEW','BOSS_REVIEW','SIGNAL_CREATED','COMPLETED','NO_CONSENSUS')) OR EXISTS (SELECT 1 FROM signals s WHERE s.case_uuid=c.uuid AND s.direction=?)) LIMIT 1",
    )
      .bind(row.config_version, candle, row.uuid, direction, direction)
      .first();
    return duplicate ? "AUTO_SNAPSHOT_ALREADY_PROCESSED" : null;
  }
  private async snapshotProblem(
    row: CaseRow,
    snapshot: CaseContext,
  ): Promise<string | null> {
    if (row.mode === "SIMULATION") return null;
    const now = Date.now();
    const age = now - (snapshot.market_read_at ?? row.created_at);
    if (age < 0 || age >= 300000) return "DECISION_SNAPSHOT_EXPIRED";
    let latest: Awaited<ReturnType<Office["marketData"]>>;
    try {
      latest = await this.marketData(snapshot.config, now);
    } catch (error) {
      // Let recognized transient D1 faults use the existing bounded recovery.
      if (
        error instanceof Error &&
        /SQLITE_BUSY|temporarily unavailable|database is locked|D1.*(?:overload|internal error|timeout)/i.test(
          error.message,
        )
      )
        throw error;
      return "MARKET_UNAVAILABLE_BEFORE_PUBLICATION";
    }
    if (JSON.stringify(latest.market) !== JSON.stringify(snapshot.market))
      return "MARKET_CHANGED_DURING_ANALYSIS";
    if (snapshot.groups?.length) {
      const scanners = scan(
        latest.market,
        snapshot.config,
        row.config_version,
        now,
      );
      const groups = analyzeGroups(
        latest.market,
        scanners,
        snapshot.config,
        row.config_version,
        now,
        latest.derivatives,
      );
      const decisions = (items: GroupSnapshot[]) =>
        items.map(({ group, direction, strength, payload }) => ({
          group,
          direction,
          strength,
          payload,
        }));
      if (
        JSON.stringify(decisions(groups)) !==
        JSON.stringify(decisions(snapshot.groups))
      )
        return "ANALYSIS_GROUPS_CHANGED_DURING_ANALYSIS";
    }
    return null;
  }
  private async processAlarm() {
    // Persist a watchdog before any external work: abrupt termination must leave
    // a wake-up behind even when the normal finally block never executes.
    await this.scheduleAlarm(Date.now() + 30000);
    const pending = await this.ctx.storage.get<number>("pending_tick");
    if (
      this.mode === "LIVE" &&
      pending !== undefined &&
      pending <= Date.now()
    ) {
      await this.tick();
      // Keep the event until the scan returns, so a restart can retry it.
      if ((await this.ctx.storage.get<number>("pending_tick")) === pending)
        await this.ctx.storage.delete("pending_tick");
    }
    await retryDeliveries(this.env);
    // Each canonical actor owns one mode; resume its in-flight work first.
    const row = await this.env.DB.prepare(
      "SELECT * FROM cases WHERE mode=? AND status IN ('QUEUED','REVALIDATING','AI_ANALYSIS','AI_DEGRADED','RISK_REVIEW','BOSS_REVIEW','SIGNAL_CREATED') ORDER BY CASE WHEN status='QUEUED' THEN 1 ELSE 0 END, created_at, id LIMIT 1",
    )
      .bind(this.mode)
      .first<CaseRow>();
    if (!row) {
      await this.ctx.storage.delete("active");
      const returning =
        (await this.ctx.storage.get<number>("return_until")) ?? 0;
      if (Date.now() < returning) {
        await this.ctx.storage.put("office", "RETURN_TO_DESK");
        await this.scheduleAlarm(returning);
        return;
      }
      const latest =
        (await this.ctx.storage.get<ScannerOutput[]>("scanners")) ?? [];
      await this.ctx.storage.put(
        "office",
        latest.some((s) => s.direction !== "NONE") ? "WATCHING" : "MONITORING",
      );
      await this.cleanup();
      const due = await this.env.DB.prepare(
        "SELECT MIN(CASE WHEN status='SENDING' THEN COALESCE(last_attempt_at,created_at)+30000 ELSE next_attempt_at END) AS time FROM discord_deliveries WHERE (status='SENDING' OR (status='PENDING' AND attempts<4)) AND ((kind='SIGNAL' AND ?=1) OR (kind!='SIGNAL' AND ?=1))",
      )
        .bind(
          this.env.DISCORD_SIGNAL_WEBHOOK ? 1 : 0,
          this.env.DISCORD_MEETING_WEBHOOK ? 1 : 0,
        )
        .first<{ time: number | null }>();
      await this.scheduleAlarm(
        Math.max(
          Date.now() + 1000,
          Math.min(Date.now() + 86400000, due?.time ?? Infinity),
        ),
      );
      return;
    }
    await this.ctx.storage.put("active", row.uuid);
    const snapshot = JSON.parse(row.context) as CaseContext;
    let nextAlarm = Date.now() + 1000;
    try {
      if (row.status === "SIGNAL_CREATED" && row.result) {
        const result = JSON.parse(row.result) as { signal: Signal };
        await notify(
          this.env,
          row,
          "SIGNAL",
          snapshot.sendDiscord,
          result.signal,
        );
        await this.status(row, "COMPLETED", result);
        if (row.mode === "LIVE") {
          if (snapshot.config.cooldownAnchor === "FROM_FINAL_DECISION") {
            const key = `cooldown:${result.signal.direction}`;
            await this.ctx.storage.put(
              key,
              Math.max(
                (await this.ctx.storage.get<number>(key)) ?? 0,
                result.signal.created_at,
              ),
            );
          }
          await this.ctx.storage.put("return_until", Date.now() + 8000);
          await this.ctx.storage.put("office", "RETURN_TO_DESK");
        }
        return;
      }
      // Validate unfinished legacy snapshots inside recovery handling. Invalid
      // settings terminate the case rather than poisoning the actor's queue.
      snapshot.config = configSchema.parse(snapshot.config);
      if (
        (row.status === "QUEUED" || row.status === "REVALIDATING") &&
        row.source === "AUTO"
      ) {
        await this.status(row, "REVALIDATING");
        const { market: latest, derivatives } = await this.marketData(
          snapshot.config,
        );
        const rescanned = scan(latest, snapshot.config, row.config_version);
        const regrouped = analyzeGroups(
          latest,
          rescanned,
          snapshot.config,
          row.config_version,
          Date.now(),
          derivatives,
        );
        const fresh = groupTrigger(
          regrouped,
          snapshot.config.scannerConsensusMin,
        );
        if (!fresh) {
          await this.status(row, "STALE", { reason: "GROUP_CONSENSUS_LOST" });
          return;
        }
        const blocked = await this.automaticBlockReason(
          row,
          snapshot.config,
          fresh,
          latest.M5.at(-1)!.timestamp,
        );
        if (blocked) {
          await this.status(row, "STALE", { reason: blocked });
          return;
        }
        if (fresh !== row.direction) {
          await this.status(row, "DIRECTION_CHANGED");
          await this.createCase(
            latest,
            rescanned,
            regrouped,
            snapshot.config,
            row.config_version,
            "LIVE",
            "AUTO",
            fresh,
            `changed:${row.uuid}:${latest.M5.at(-1)!.timestamp}`,
            snapshot.sendDiscord,
            "NONE",
          );
          return;
        }
        snapshot.market = latest;
        snapshot.scanners = rescanned;
        snapshot.groups = regrouped;
        snapshot.market_read_at = Date.now();
        row.candle_timestamp = latest.M5.at(-1)!.timestamp;
        row.context = JSON.stringify(snapshot);
        await this.env.DB.prepare(
          "UPDATE cases SET context=?,candle_timestamp=? WHERE uuid=? AND status='REVALIDATING'",
        )
          .bind(row.context, row.candle_timestamp, row.uuid)
          .run();
      }
      await this.status(row, "AI_ANALYSIS");
      await notify(this.env, row, "MEETING", snapshot.sendDiscord);
      await this.pipeline(row, snapshot);
    } catch (error) {
      const current = await this.env.DB.prepare(
        "SELECT status FROM cases WHERE uuid=?",
      )
        .bind(row.uuid)
        .first<{ status: string }>();
      if (
        current &&
        !["CONFIG_CHANGED", "CANCELLED"].includes(current.status)
      ) {
        const message = redact(
          error instanceof Error ? error.message : "Pipeline failed",
          this.env,
        );
        const retries =
          (await this.ctx.storage.get<number>(`recovery:${row.uuid}`)) ?? 0;
        if (
          /SQLITE_BUSY|temporarily unavailable|database is locked|D1.*(?:overload|internal error|timeout)/i.test(
            message,
          ) &&
          retries < 3
        ) {
          await this.ctx.storage.put(`recovery:${row.uuid}`, retries + 1);
          nextAlarm = Date.now() + 1000 * 2 ** retries;
          await this.env.DB.prepare(
            "INSERT INTO case_events(case_uuid,status,created_at) VALUES (?,?,?)",
          )
            .bind(row.uuid, "RECOVERY_PENDING", Date.now())
            .run();
        } else {
          await this.status(row, "FAILED", { error: message });
        }
      }
    } finally {
      if (
        row.mode === "LIVE" &&
        row.source === "AUTO" &&
        row.direction &&
        snapshot.config.cooldownAnchor === "FROM_FINAL_DECISION" &&
        row.status === "NO_CONSENSUS"
      )
        await this.ctx.storage.put(`cooldown:${row.direction}`, Date.now());
      await this.ctx.storage.delete("active");
      if (
        [
          "COMPLETED",
          "NO_CONSENSUS",
          "FAILED",
          "STALE",
          "DIRECTION_CHANGED",
        ].includes(row.status)
      )
        await this.ctx.storage.delete(`recovery:${row.uuid}`);
      await this.scheduleAlarm(nextAlarm);
    }
  }
  private runtime(
    row: CaseRow,
    c: CharacterConfig,
    config: TradingConfig,
  ): AIRuntime {
    let reserved = 0;
    return {
      getCircuit: async (p) =>
        (await this.ctx.storage.get<Circuit>(`circuit:${p}`)) ?? {
          failures: 0,
          openedAt: 0,
        },
      setCircuit: async (p, value) => {
        await this.ctx.storage.transaction(async (t) => {
          const key = `circuit:${p}`,
            current = (await t.get<Circuit>(key)) ?? {
              failures: 0,
              openedAt: 0,
            };
          await t.put(
            key,
            value.failures === 0
              ? value
              : circuitResult(current, false, await this.policy(p)),
          );
        });
      },
      policy: (p) => this.policy(p),
      acquireCircuit: async (p, policy) =>
        this.ctx.storage.transaction(async (t) => {
          const key = `circuit:${p}`;
          const value = (await t.get<Circuit>(key)) ?? {
            failures: 0,
            openedAt: 0,
          };
          const state = circuitState(value, Date.now(), policy.cooldownMs);
          if (
            state === "OPEN" ||
            (state === "HALF_OPEN" && (value.probeUntil ?? 0) > Date.now())
          )
            return false;
          if (state === "HALF_OPEN")
            await t.put(key, { ...value, probeUntil: Date.now() + 180000 });
          return true;
        }),
      beforeCall: async (estimate = c.max_output_tokens) => {
        await this.ctx.storage.transaction(async (t) => {
          const key = `calls:${row.uuid}`,
            n = (await t.get<number>(key)) ?? 0;
          const tokens =
            (await t.get<number>(`reserved_tokens:${row.uuid}`)) ?? 0;
          if (config.budgets.callsPerCase && n >= config.budgets.callsPerCase)
            throw new Error("Case call budget exceeded");
          if (
            config.budgets.tokensPerCase &&
            tokens + estimate > config.budgets.tokensPerCase
          )
            throw new Error("Case token budget exceeded");
          await t.put(key, n + 1);
          await t.put(`reserved_tokens:${row.uuid}`, tokens + estimate);
          reserved = estimate;
        });
      },
      audit: async (e) => {
        await this.env.DB.batch([
          this.env.DB.prepare(
            "INSERT INTO ai_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          ).bind(
            crypto.randomUUID(),
            row.uuid,
            c.id,
            e.provider,
            e.model,
            c.prompt_version,
            e.attempt,
            e.status,
            e.tokens,
            e.raw ?? null,
            redact(e.prompt, this.env),
            Date.now(),
          ),
          this.env.DB.prepare(
            "INSERT INTO usage_daily(day,calls,tokens) VALUES (?,1,?) ON CONFLICT(day) DO UPDATE SET calls=calls+1,tokens=tokens+excluded.tokens",
          ).bind(wibDate(), e.tokens),
        ]);
        await this.ctx.storage.transaction(async (t) => {
          const key = `tokens:${row.uuid}`;
          await t.put(key, ((await t.get<number>(key)) ?? 0) + e.tokens);
          const reservation = `reserved_tokens:${row.uuid}`;
          await t.put(
            reservation,
            Math.max(
              0,
              ((await t.get<number>(reservation)) ?? 0) - reserved + e.tokens,
            ),
          );
        });
        reserved = 0;
      },
    };
  }
  private async policy(p: string): Promise<ProviderPolicy> {
    const row = await this.env.DB.prepare(
      "SELECT snapshot FROM provider_configs WHERE id=?",
    )
      .bind(p)
      .first<{ snapshot: string }>();
    return row ? JSON.parse(row.snapshot) : defaultPolicy;
  }
  private async character(
    row: CaseRow,
    c: CharacterConfig,
    context: unknown,
    config: TradingConfig,
  ) {
    const saved = await this.env.DB.prepare(
      "SELECT snapshot FROM ai_character_outputs WHERE case_uuid=? AND character_id=?",
    )
      .bind(row.uuid, c.id)
      .first<{ snapshot: string }>();
    if (saved) {
      const output = JSON.parse(saved.snapshot) as AnalystResult;
      if (output.status !== "SUCCESS") return output;
      const parsed = analysisSchema.safeParse(output.output);
      const errors = parsed.success
        ? characterSemanticErrors(c, parsed.data, context)
        : ["Saved AI output violates the structured schema"];
      if (!errors.length) return output;
      // Recovery must enforce current authority contracts without paying to
      // replace a completed response. The original raw audit remains in ai_runs.
      const invalid: AnalystResult = {
        ...output,
        status: "UNAVAILABLE",
        output: undefined,
        flags: [...new Set([...output.flags, "SEMANTIC_VALIDATION_FAILED"])],
        validationErrors: [...output.validationErrors, ...errors],
      };
      await this.env.DB.prepare(
        "UPDATE ai_character_outputs SET snapshot=? WHERE case_uuid=? AND character_id=?",
      )
        .bind(JSON.stringify(invalid), row.uuid, c.id)
        .run();
      return invalid;
    }
    const output = await runCharacter(
      this.env,
      c,
      context,
      this.runtime(row, c, config),
    );
    await this.env.DB.prepare(
      "INSERT OR IGNORE INTO ai_character_outputs VALUES (?,?,?)",
    )
      .bind(row.uuid, c.id, JSON.stringify(output))
      .run();
    return output;
  }
  private async pipeline(row: CaseRow, s: CaseContext) {
    // Do not pay for new inference or reuse old votes against a changed market.
    const beforeAnalysis = await this.snapshotProblem(row, s);
    if (beforeAnalysis) {
      await this.status(row, "STALE", { reason: beforeAnalysis });
      return;
    }
    const context = buildContext(s.market, s.scanners, s.config);
    const groups = s.groups?.length
      ? s.groups
      : analyzeGroups(s.market, s.scanners, s.config, row.config_version);
    const settled = await Promise.allSettled(
      s.characters
        .filter((c) => c.id !== "risk" && c.id !== "boss")
        .map((c) => {
          const specialization = analystGroup(c.id);
          if (!specialization)
            throw new Error(`No analysis group assigned to ${c.id}`);
          const group = groups.find((item) => item.group === specialization);
          if (!group)
            throw new Error(`Missing ${specialization} deterministic snapshot`);
          return this.character(
            row,
            c,
            {
              ...buildGroupContext(s.market, group, s.config, c.id),
              case_id: row.id,
              focus: s.focus,
            },
            s.config,
          );
        }),
    );
    // Do not start recovery while sibling provider requests are still running.
    const rejected = settled.find((r) => r.status === "rejected");
    if (rejected?.status === "rejected") throw rejected.reason;
    const analysts = settled.map((r) => {
      if (r.status !== "fulfilled") throw new Error("Analyst stage incomplete");
      return r.value;
    });
    const consensus = groupTrigger(groups, s.config.scannerConsensusMin);
    // An Emergency investigation is context, never voting authority. Without
    // group consensus it needs valid AI participation or a valid Boss tie-break.
    const fallback =
      row.source === "EMERGENCY"
        ? consensus
        : (consensus ?? fallbackDirection(groups, s.market));
    if (s.strict_replay && analysts.some((a) => a.status !== "SUCCESS"))
      throw new Error(
        "STRICT replay failed: historical Analyst provider/model is unavailable",
      );
    let vote = voting(analysts, fallback);
    if (!consensus && fallback && vote.direction === fallback)
      vote.flags.push("DETERMINISTIC_DIRECTION_FALLBACK");
    if (vote.degraded) await this.status(row, "AI_DEGRADED");
    await this.status(row, "RISK_REVIEW");
    const proposals: Partial<Record<TradeDirection, ReturnType<typeof risk>>> =
      {};
    for (const d of ["BUY", "SELL"] as const)
      try {
        proposals[d] = risk(d, s.market, s.config, s.tick_size ?? 0.01);
      } catch {
        /* Missing structural target is a no-trade condition, never synthetic TP. */
      }
    const riskReview = await this.character(
      row,
      s.characters.find((c) => c.id === "risk")!,
      {
        ...context.payload,
        analysis_groups: groups,
        analysts,
        voting: vote,
        risk_proposals: proposals,
      },
      s.config,
    );
    if (s.strict_replay && riskReview.status !== "SUCCESS")
      throw new Error(
        "STRICT replay failed: historical Risk Manager provider/model is unavailable",
      );
    await this.env.DB.prepare("INSERT OR REPLACE INTO risk_runs VALUES (?,?)")
      .bind(row.uuid, JSON.stringify({ proposals, review: riskReview }))
      .run();
    await this.status(row, "BOSS_REVIEW");
    const boss = await this.character(
      row,
      s.characters.find((c) => c.id === "boss")!,
      {
        ...context.payload,
        analysis_groups: groups,
        analysts,
        voting: vote,
        risk_proposals: proposals,
        risk_review: riskReview.output ?? null,
      },
      s.config,
    );
    if (s.strict_replay && boss.status !== "SUCCESS")
      throw new Error(
        "STRICT replay failed: historical Boss provider/model is unavailable",
      );
    await this.env.DB.prepare(
      "INSERT OR REPLACE INTO boss_decisions VALUES (?,?)",
    )
      .bind(row.uuid, JSON.stringify(boss))
      .run();
    if (vote.tie)
      vote = voting(analysts, fallback, boss.output?.vote ?? "NO_TRADE");
    const current = await this.env.DB.prepare(
      "SELECT status FROM cases WHERE uuid=?",
    )
      .bind(row.uuid)
      .first<{ status: string }>();
    if (current?.status === "CONFIG_CHANGED") return;
    const d = vote.direction;
    if (!d || !proposals[d]) {
      await this.status(row, "NO_CONSENSUS", {
        analysts,
        vote,
        riskReview,
        boss,
        reason: d ? "INVALID_RISK_PROPOSAL" : "No directional consensus",
      });
      await notify(
        this.env,
        row,
        "NO_CONSENSUS",
        s.sendDiscord && s.config.notifyNoConsensus,
      );
      return;
    }
    const problem =
      (await this.snapshotProblem(row, s)) ??
      (row.source === "AUTO"
        ? await this.automaticBlockReason(
            row,
            s.config,
            d,
            s.market.M5.at(-1)!.timestamp,
          )
        : null);
    if (problem) {
      await this.status(row, "STALE", {
        analysts,
        vote,
        riskReview,
        boss,
        reason: problem,
      });
      return;
    }
    const r = proposals[d]!;
    const mtf = [
      bias(indicators(s.market.H1, s.config)),
      bias(indicators(s.market.M15, s.config)),
      bias(indicators(s.market.M5, s.config)),
    ];
    const score = confidence(d, groups, analysts, mtf, s.config);
    const flags = [
      ...r.flags,
      ...vote.flags,
      ...(mtf[0] !== "NONE" && mtf[0] !== d ? ["COUNTER_TREND"] : []),
      ...(row.source === "EMERGENCY" ? ["MANUAL", "EMERGENCY"] : []),
      ...(!riskReview.output ? ["RISK_MANAGER_FALLBACK"] : []),
      ...(!boss.output ? ["BOSS_UNAVAILABLE"] : []),
    ];
    const signal: Signal = {
      ...r,
      signal_uuid: crypto.randomUUID(),
      signal_id: await this.id("SIG"),
      case_uuid: row.uuid,
      case_id: row.id,
      market: MARKET,
      direction: d,
      confidence: score.total,
      h1_bias: mtf[0],
      m15_setup: mtf[1],
      m5_trigger: mtf[2],
      scanner_composition: composition(s.scanners),
      group_composition: groupComposition(groups),
      ai_vote_composition: vote.counts,
      flags,
      source: row.source === "EMERGENCY" ? "EMERGENCY" : "AUTO",
      created_at: Date.now(),
      config_version: row.config_version,
      minimum_risk_reward: s.config.minRR,
      tick_size: s.tick_size ?? 0.01,
      boss_summary:
        boss.output?.summary ??
        "Boss unavailable; deterministic consensus used",
    };
    const result = {
      signal,
      score,
      analysts,
      riskReview,
      boss,
      vote,
      groups,
      context_compressed: context.context_compressed,
    };
    if (row.mode === "LIVE") {
      await this.env.DB.batch([
        this.env.DB.prepare(
          "INSERT OR IGNORE INTO signals SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM cases WHERE uuid=? AND status='BOSS_REVIEW')",
        ).bind(
          signal.signal_uuid,
          signal.signal_id,
          row.uuid,
          d,
          signal.confidence,
          signal.created_at,
          JSON.stringify(signal),
          row.uuid,
        ),
        this.env.DB.prepare(
          "UPDATE cases SET status='SIGNAL_CREATED',result=?,updated_at=? WHERE uuid=? AND status='BOSS_REVIEW' AND EXISTS (SELECT 1 FROM signals WHERE case_uuid=?)",
        ).bind(JSON.stringify(result), Date.now(), row.uuid, row.uuid),
      ]);
      const saved = await this.env.DB.prepare(
        "SELECT snapshot FROM signals WHERE case_uuid=?",
      )
        .bind(row.uuid)
        .first<{ snapshot: string }>();
      if (!saved) throw new Error("Case cancelled before signal publication");
      result.signal = JSON.parse(saved.snapshot);
      await this.status(row, "SIGNAL_CREATED", result);
      // Persist cooldown before external delivery can fail or be interrupted.
      if (s.config.cooldownAnchor === "FROM_FINAL_DECISION")
        await this.ctx.storage.put(`cooldown:${d}`, result.signal.created_at);
      await this.ctx.storage.put("office", "DISCORD");
      await notify(this.env, row, "SIGNAL", s.sendDiscord, result.signal);
    }
    await this.status(row, "COMPLETED", result);
    if (row.mode === "LIVE") {
      await this.ctx.storage.put("return_until", Date.now() + 8000);
      await this.ctx.storage.put("office", "RETURN_TO_DESK");
    }
  }
  private async cleanup() {
    const { config } = await this.config();
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE ai_runs SET raw=NULL,rendered_prompt=NULL WHERE created_at<? AND (raw IS NOT NULL OR rendered_prompt IS NOT NULL)",
      ).bind(Date.now() - config.retentionDays * 86400000),
      this.env.DB.prepare("DELETE FROM sessions WHERE expires_at<?").bind(
        Date.now(),
      ),
      this.env.DB.prepare("DELETE FROM login_limits WHERE reset_at<?").bind(
        Date.now(),
      ),
      this.env.DB.prepare("DELETE FROM api_limits WHERE reset_at<?").bind(
        Date.now(),
      ),
    ]);
  }
}
