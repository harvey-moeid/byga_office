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

export function redactScanner(
  scanner: import("../core/contracts").ScannerOutput,
) {
  return {
    name: scanner.name,
    direction: scanner.direction,
    strength: scanner.strength,
    h1_bias: scanner.h1_bias,
    m15_setup: scanner.m15_setup,
    m5_trigger: scanner.m5_trigger,
    timestamp: scanner.timestamp,
    candle_timestamp: scanner.candle_timestamp,
    config_version: scanner.config_version,
    levels: [],
    indicators: {},
    reasons: [privateText("")],
  };
}
export function redactOfficeState(state: import("../core/api").OfficeState) {
  return {
    ...state,
    scanners: state.scanners.map(redactScanner),
    groups: state.groups?.map((group) => ({
      ...group,
      payload: {},
      reasons: [privateText("")],
    })),
  };
}
export function redactMeeting(
  meeting: import("../core/meeting").MeetingSnapshot | null,
) {
  if (!meeting) return null;
  return {
    ...meeting,
    prices_private: true,
    ...(meeting.scan
      ? {
          scan: {
            ...meeting.scan,
            groups: meeting.scan.groups.map((group) => ({
              group: group.group,
              direction: group.direction,
              strength: group.strength,
              reasons: [privateText("")],
            })),
          },
        }
      : {}),
    turns: meeting.turns.map((turn) =>
      "source" in turn
        ? {
            ...turn,
            scanner: {
              ...turn.scanner,
              summary: privateText(""),
              reasoning: privateText(""),
            },
          }
        : { ...turn, analysis: redactPrivateAnalysis(turn.analysis) },
    ),
  };
}
