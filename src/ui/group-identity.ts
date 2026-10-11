import type { CharacterId } from "../core/contracts";
import { analystGroup } from "../core/engine";

export const groupIdentity = {
  SMC_ICT: { label: "SMC / ICT", color: "#e3ba68" },
  INDICATORS: { label: "Indikator", color: "#78b9ef" },
  VOLUME: { label: "Volume", color: "#70d5ba" },
  DERIVATIVES_POSITIONING: { label: "Derivatives", color: "#c6a0ee" },
} as const;
export function characterIdentity(id: CharacterId) {
  return id === "risk"
    ? { label: "Risk", color: "#e99384" }
    : id === "boss"
      ? { label: "Head Trader", color: "#ebd7a3" }
      : groupIdentity[analystGroup(id)!];
}
