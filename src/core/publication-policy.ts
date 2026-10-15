import { z } from "zod";
import type { AnalystResult, TradeDirection } from "./contracts";

export const publicationPolicySchema = z
  .object({
    riskVeto: z.boolean(),
    bossVeto: z.boolean(),
    requireAiQuorum: z.boolean(),
    minConfidence: z.number().finite().min(0).max(100),
    blockLowRR: z.boolean(),
  })
  .strict();
export type PublicationPolicy = z.infer<typeof publicationPolicySchema>;
export const strictPublicationPolicy: PublicationPolicy = {
  riskVeto: true,
  bossVeto: true,
  requireAiQuorum: true,
  minConfidence: 60,
  blockLowRR: true,
};
// An absent policy identifies historical snapshots created under advisory rules.
export function publicationBlockReason(
  policy: PublicationPolicy | undefined,
  input: {
    direction: TradeDirection;
    analysts: AnalystResult[];
    riskReview: AnalystResult;
    boss: AnalystResult;
    confidence: number;
    riskReward: number;
    minimumRR: number;
  },
): string | null {
  if (!policy) return null;
  const approves = (result: AnalystResult) =>
    result.status === "SUCCESS" &&
    result.output?.vote === input.direction &&
    !result.flags.includes("SEMANTIC_VALIDATION_FAILED");
  if (
    policy.requireAiQuorum &&
    input.analysts.filter(approves).length <
      Math.max(2, Math.ceil(input.analysts.length / 2))
  )
    return "AI_QUORUM_REQUIRED";
  if (policy.riskVeto && !approves(input.riskReview)) return "RISK_VETO";
  if (policy.bossVeto && !approves(input.boss)) return "BOSS_VETO";
  if (
    !Number.isFinite(input.confidence) ||
    input.confidence < policy.minConfidence
  )
    return "CONFIDENCE_BELOW_MINIMUM";
  if (
    policy.blockLowRR &&
    (!Number.isFinite(input.riskReward) || input.riskReward < input.minimumRR)
  )
    return "LOW_RR_BLOCKED";
  return null;
}
