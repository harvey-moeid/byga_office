import { z } from "zod";
import { json } from "./auth";

const deletionSchema = z.object({
  mode: z.enum(["LIVE", "SIMULATION"]),
  caseId: z.string().min(1).max(100).optional(),
  before: z.number().int().nonnegative(),
  confirmed: z.literal(true),
});

export async function deleteHistory(db: D1Database, input: unknown) {
  const body = deletionSchema.parse(input);
  // One atomic statement: never hide an active case, including during a cron tick.
  // Keep source records so deletion cannot reset budgets or allow duplicate trades.
  const result = await db
    .prepare(
      `
    INSERT OR IGNORE INTO history_deletions(case_uuid,deleted_at)
    SELECT uuid,? FROM cases
    WHERE mode=? AND created_at<=? AND (? IS NULL OR id=?)
      AND status IN ('COMPLETED','NO_CONSENSUS','FAILED','CONFIG_CHANGED','STALE','CANCELLED','DIRECTION_CHANGED')
  `,
    )
    .bind(
      Date.now(),
      body.mode,
      body.before,
      body.caseId ?? null,
      body.caseId ?? null,
    )
    .run();
  return json({ deleted: result.meta.changes });
}
