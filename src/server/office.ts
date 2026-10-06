import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import {
  analysisGroups,
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
import { json } from "./auth";
import type { Env } from "./env";
import { chartSchema, readDerivatives, readMarket } from "./market";
import {
  circuitResult,
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
  strict_replay?: boolean;
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
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
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
    const action = () => this.route(request);
    const next = this.queue.then(action, action);
    this.queue = next.catch(() => {});
    try {
      return await next;
    } catch (error) {
      return json(
        {
          error:
            error instanceof z.ZodError
              ? error.flatten()
              : error instanceof Error
                ? error.message
                : "Operation failed",
        },
        400,
      );
    }
  }
  private async route(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/wake") {
      await this.ctx.storage.setAlarm(Date.now() + 1000);
      return json({ ok: true });
    }
    if (path === "/tick") {
      await this.tick();
      return json({ ok: true });
    }
    if (path === "/state") {
      const { config } = await this.config();
      const active = await this.env.DB.prepare(
        "SELECT id,status FROM cases WHERE mode='LIVE' AND status IN ('REVALIDATING','AI_ANALYSIS','AI_DEGRADED','RISK_REVIEW','BOSS_REVIEW') ORDER BY created_at LIMIT 1",
      ).first();
      return json({
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
        error: (await this.ctx.storage.get("market_error")) ?? null,
      });
    }
    if (path === "/config" && request.method === "GET") {
      const active = await this.config();
      const versions = await this.env.DB.prepare(
        "SELECT id,created_at FROM trading_config_versions ORDER BY version DESC LIMIT 100",
      ).all();
      return json({ ...active, versions: versions.results });
    }
    if (path === "/config") {
      const body = z
        .object({
          config: configSchema,
          activation: z.enum(["NEXT CASE", "APPLY NOW"]),
          confirmed: z.boolean().optional(),
        })
        .parse(await request.json());
      if (body.activation === "APPLY NOW" && !body.confirmed)
        return json({ error: "APPLY NOW requires confirmation" }, 409);
      const v =
        (await this.env.DB.prepare(
          "SELECT MAX(version) AS version FROM trading_config_versions",
        ).first<{ version: number }>())!.version + 1;
      const id = `TRADING-CONFIG-v${v}`;
      await this.env.DB.batch([
        this.env.DB.prepare(
          "INSERT INTO trading_config_versions VALUES (?,?,?,?)",
        ).bind(id, v, JSON.stringify(body.config), Date.now()),
        this.env.DB.prepare(
          "UPDATE system_state SET value=? WHERE key='active_config'",
        ).bind(id),
      ]);
      if (body.activation === "APPLY NOW") {
        const old = await this.env.DB.prepare(
          "SELECT * FROM cases WHERE mode='LIVE' AND status IN ('QUEUED','REVALIDATING','AI_ANALYSIS','AI_DEGRADED','RISK_REVIEW','BOSS_REVIEW') ORDER BY created_at LIMIT 1",
        ).first<CaseRow>();
        if (old) {
          await this.status(old, "CONFIG_CHANGED");
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
          await this.createCase(
            market,
            scanners,
            groups,
            body.config,
            id,
            old.mode,
            old.source,
            old.direction,
            `config:${old.uuid}:${id}`,
            false,
            "NONE",
          );
        }
      }
      return json({ id });
    }
    if (path === "/characters" && request.method === "GET")
      return json(await this.characters());
    if (path === "/characters") {
      const c = characterSchema.parse(await request.json());
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
      const { id } = z.object({ id: z.string() }).parse(await request.json());
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
        .parse(await request.json());
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
        .parse(await request.json());
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
        await this.ctx.storage.put(`models:${id}`, { at: Date.now(), models });
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
        if (path === "/test-provider")
          await this.ctx.storage.put(`circuit:${id}`, {
            failures: 0,
            openedAt: 0,
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
      const body = emergencySchema.parse(await request.json()),
        { id, config } = await this.config();
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
      );
      return json(item, 202);
    }
    if (path === "/simulation") {
      const body = simulationSchema.parse(await request.json());
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
      const { market, derivatives } = await this.marketData(config, body.timestamp);
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
      );
      await this.env.DB.prepare(
        "INSERT OR IGNORE INTO simulation_runs VALUES (?,?,?,?,?)",
      )
        .bind(
          crypto.randomUUID(),
          item.uuid,
          body.replayMode,
          body.configMode,
          Date.now(),
        )
        .run();
      return json(item, 202);
    }
    return json({ error: "Unknown action" }, 404);
  }
  private async tick() {
    // An idle office still needs scheduled retention and outbox maintenance.
    if ((await this.ctx.storage.getAlarm()) === null)
      await this.ctx.storage.setAlarm(Date.now() + 1000);
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
        const last =
          (await this.ctx.storage.get<number>(`cooldown:${direction}`)) ?? 0;
        if (Date.now() - last >= config.cooldownMinutes * 60000) {
          const item = await this.createCase(
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
          if (config.cooldownAnchor === "FROM_TRIGGER")
            await this.ctx.storage.put(
              `cooldown:${direction}`,
              item.created_at,
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
      await this.ctx.storage.setAlarm(Date.now() + 1000);
    } catch (error) {
      await this.ctx.storage.put(
        "market_error",
        error instanceof Error ? error.message : "Market unavailable",
      );
    }
  }
  private async createCase(
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
  ) {
    const existing = await this.env.DB.prepare(
      "SELECT * FROM cases WHERE idempotency_key=?",
    )
      .bind(key)
      .first<CaseRow>();
    if (existing) return existing;
    const context: CaseContext = {
      market,
      scanners,
      groups,
      config,
      characters: characters ?? (await this.characters()),
      sendDiscord,
      focus,
      strict_replay: strictReplay,
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
    const day = wibDate(now);
    const dayStart = Date.parse(
      `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T00:00:00+07:00`,
    );
    const liveLimit = mode === "LIVE" ? config.budgets.casesPerDay : 0;
    const sourceLimit =
      source === "EMERGENCY"
        ? config.budgets.emergenciesPerDay
        : source === "SIMULATION"
          ? config.budgets.simulationsPerDay
          : 0;
    const inserted = await this.env.DB.prepare(
      "INSERT OR IGNORE INTO cases SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (?=0 OR (SELECT COUNT(*) FROM cases WHERE mode='LIVE' AND created_at>=?)<?) AND (?=0 OR (SELECT COUNT(*) FROM cases WHERE source=? AND created_at>=?)<?)",
    )
      .bind(
        ...Object.values(row),
        liveLimit,
        dayStart,
        liveLimit,
        sourceLimit,
        source,
        dayStart,
        sourceLimit,
      )
      .run();
    if (!inserted.meta.changes) {
      const duplicate = await this.env.DB.prepare(
        "SELECT * FROM cases WHERE idempotency_key=?",
      )
        .bind(key)
        .first<CaseRow>();
      if (duplicate) return duplicate;
      throw new Error("Daily AI case budget reached");
    }
    await this.env.DB.prepare(
      "INSERT INTO case_events(case_uuid,status,created_at) VALUES (?,?,?)",
    )
      .bind(row.uuid, "QUEUED", now)
      .run();
    await this.ctx.storage.setAlarm(Date.now() + 1000);
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
    // Persist a watchdog before any external work: abrupt termination must leave
    // a wake-up behind even when the normal finally block never executes.
    await this.ctx.storage.setAlarm(Date.now() + 30000);
    await retryDeliveries(this.env);
    // Never select work from a single persisted "mode" flag: a simulation
    // must not strand live trading work. Resume LIVE first, then SIMULATION;
    // within the same mode, resume in-flight work before queued work.
    const row = await this.env.DB.prepare(
      "SELECT * FROM cases WHERE status IN ('QUEUED','REVALIDATING','AI_ANALYSIS','AI_DEGRADED','RISK_REVIEW','BOSS_REVIEW','SIGNAL_CREATED') ORDER BY CASE WHEN mode='LIVE' THEN 0 ELSE 1 END, CASE WHEN status='QUEUED' THEN 1 ELSE 0 END, created_at LIMIT 1",
    ).first<CaseRow>();
    if (!row) {
      await this.ctx.storage.delete("active");
      const returning =
        (await this.ctx.storage.get<number>("return_until")) ?? 0;
      if (Date.now() < returning) {
        await this.ctx.storage.put("office", "RETURN_TO_DESK");
        await this.ctx.storage.setAlarm(returning);
        return;
      }
      const latest =
        (await this.ctx.storage.get<ScannerOutput[]>("scanners")) ?? [];
      await this.ctx.storage.put(
        "office",
        latest.some((s) => s.direction !== "NONE")
          ? "WATCHING"
          : "MONITORING",
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
      await this.ctx.storage.setAlarm(
        Math.max(
          Date.now() + 1000,
          Math.min(Date.now() + 86400000, due?.time ?? Infinity),
        ),
      );
      return;
    }
    await this.ctx.storage.put("active", row.uuid);
    const snapshot = JSON.parse(row.context) as CaseContext;
    // Historical and in-flight snapshots created before this setting keep the default.
    snapshot.config = configSchema.parse(snapshot.config);
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
      if (
        (row.status === "QUEUED" || row.status === "REVALIDATING") &&
        row.source === "AUTO"
      ) {
        await this.status(row, "REVALIDATING");
        const { market: latest, derivatives } = await this.marketData(snapshot.config);
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
          await this.status(row, "STALE");
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
        row.context = JSON.stringify(snapshot);
        await this.env.DB.prepare(
          "UPDATE cases SET context=?,candle_timestamp=? WHERE uuid=?",
        )
          .bind(row.context, latest.M5.at(-1)!.timestamp, row.uuid)
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
        ["COMPLETED", "NO_CONSENSUS"].includes(row.status)
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
      await this.ctx.storage.setAlarm(nextAlarm);
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
    if (saved) return JSON.parse(saved.snapshot) as AnalystResult;
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
    const context = buildContext(s.market, s.scanners, s.config);
    const groups =
      s.groups?.length
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
              ...buildGroupContext(s.market, group, s.config),
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
    const fallback =
      consensus ??
      (s.focus !== "NONE" ? s.focus : fallbackDirection(groups, s.market));
    if (s.strict_replay && analysts.some((a) => a.status !== "SUCCESS"))
      throw new Error(
        "STRICT replay failed: historical Analyst provider/model is unavailable",
      );
    let vote = voting(analysts, fallback);
    if (!consensus && vote.direction === fallback)
      vote.flags.push(
        s.focus !== "NONE"
          ? "MANUAL_FOCUS_FALLBACK"
          : "DETERMINISTIC_DIRECTION_FALLBACK",
      );
    if (vote.degraded) await this.status(row, "AI_DEGRADED");
    await this.status(row, "RISK_REVIEW");
    const proposals: Partial<Record<TradeDirection, ReturnType<typeof risk>>> =
      {};
    for (const d of ["BUY", "SELL"] as const)
      try {
        proposals[d] = risk(d, s.market, s.config);
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
        reason: d
          ? "No valid structural risk proposal"
          : "No directional consensus",
      });
      await notify(
        this.env,
        row,
        "NO_CONSENSUS",
        s.sendDiscord && s.config.notifyNoConsensus,
      );
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
      await this.ctx.storage.put("office", "DISCORD");
      await notify(this.env, row, "SIGNAL", s.sendDiscord, result.signal);
      if (s.config.cooldownAnchor === "FROM_FINAL_DECISION")
        await this.ctx.storage.put(`cooldown:${d}`, Date.now());
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
