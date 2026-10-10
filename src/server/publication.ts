import type { Analysis } from "../core/contracts";

// Arbitrary AI prose may spell out or encode prices. Public Signals OFF keeps
// free-form analysis private as well; role, validated vote and confidence remain.
export function privateText(_text: string) {
  return "Detail analisis dirahasiakan karena Public Signals OFF.";
}
export function redactPrivateAnalysis(analysis: Analysis): Analysis {
  return {
    ...analysis,
    price_levels: null,
    summary: privateText(analysis.summary),
    reasoning: privateText(analysis.reasoning),
    evidence: [],
    risk_flags: [],
  };
}
