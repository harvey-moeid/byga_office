import { describe, expect, it } from "vitest";
import {
  defaultCharacters,
  defaultConfig,
  configSchema,
  type AnalystResult,
} from "../src/core/contracts";
import {
  publicationBlockReason,
  strictPublicationPolicy,
} from "../src/core/publication-policy";
const approval = (
  vote: "BUY" | "SELL" | "NO_TRADE" = "BUY",
): AnalystResult => ({
  id: "trend",
  status: "SUCCESS",
  flags: [],
  validationErrors: [],
  provider: "openrouter",
  model: "fixture",
  prompt_version: "v1",
  output: {
    vote,
    confidence: 80,
    summary: "fixture",
    reasoning: "fixture",
    evidence: [],
    risk_flags: [],
    price_levels: null,
  },
});
const input = () => ({
  direction: "BUY" as const,
  analysts: Array.from({ length: 8 }, () => approval()),
  riskReview: approval(),
  boss: approval(),
  confidence: 70,
  riskReward: 2,
  minimumRR: 1.5,
});
describe("publication policy", () => {
  it("defaults new offices to strict approval while retaining legacy snapshot semantics", () => {
    expect(defaultConfig.publicationPolicy).toEqual(strictPublicationPolicy);
    const { publicationPolicy: _policy, ...legacy } = defaultConfig;
    expect(configSchema.parse(legacy).publicationPolicy).toBeUndefined();
    expect(
      publicationBlockReason(undefined, {
        ...input(),
        analysts: [],
        boss: approval("NO_TRADE"),
      }),
    ).toBeNull();
    expect(defaultCharacters()).toHaveLength(10);
  });
  it("requires directional quorum even when all AI abstains or providers are unavailable", () => {
    expect(
      publicationBlockReason(strictPublicationPolicy, {
        ...input(),
        analysts: Array.from({ length: 8 }, () => approval("NO_TRADE")),
      }),
    ).toBe("AI_QUORUM_REQUIRED");
    expect(
      publicationBlockReason(strictPublicationPolicy, {
        ...input(),
        analysts: [
          approval(),
          ...Array.from({ length: 7 }, () => ({
            ...approval(),
            status: "UNAVAILABLE" as const,
          })),
        ],
      }),
    ).toBe("AI_QUORUM_REQUIRED");
    expect(
      publicationBlockReason(strictPublicationPolicy, {
        ...input(),
        analysts: [
          approval(),
          approval(),
          approval("NO_TRADE"),
          approval("NO_TRADE"),
        ],
      }),
    ).toBeNull();
  });
  it.each(["NO_TRADE", "SELL"] as const)(
    "vetoes unapproved %s Risk/Boss direction",
    (vote) => {
      expect(
        publicationBlockReason(strictPublicationPolicy, {
          ...input(),
          riskReview: approval(vote),
        }),
      ).toBe("RISK_VETO");
      expect(
        publicationBlockReason(strictPublicationPolicy, {
          ...input(),
          boss: approval(vote),
        }),
      ).toBe("BOSS_VETO");
    },
  );
  it("rejects absent/invalid approvals, low confidence and low R:R, and allows approved boundaries", () => {
    expect(
      publicationBlockReason(strictPublicationPolicy, {
        ...input(),
        riskReview: { ...approval(), status: "UNAVAILABLE" },
      }),
    ).toBe("RISK_VETO");
    expect(
      publicationBlockReason(strictPublicationPolicy, {
        ...input(),
        boss: { ...approval(), flags: ["SEMANTIC_VALIDATION_FAILED"] },
      }),
    ).toBe("BOSS_VETO");
    expect(
      publicationBlockReason(strictPublicationPolicy, {
        ...input(),
        confidence: 59,
      }),
    ).toBe("CONFIDENCE_BELOW_MINIMUM");
    expect(
      publicationBlockReason(strictPublicationPolicy, {
        ...input(),
        riskReward: 1.49,
      }),
    ).toBe("LOW_RR_BLOCKED");
    expect(
      publicationBlockReason(strictPublicationPolicy, {
        ...input(),
        confidence: 60,
        riskReward: 1.5,
      }),
    ).toBeNull();
  });
});
