import { z } from "zod";
import {
  configSchema,
  type GroupSnapshot,
  type ScannerOutput,
} from "./contracts";

export const configWriteSchema = z.object({
  config: configSchema,
  activation: z.enum(["NEXT CASE", "APPLY NOW"]),
  confirmed: z.boolean().optional(),
  expectedVersion: z.string().min(1).max(100).optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
});
export type ConfigWrite = z.infer<typeof configWriteSchema>;
export interface ConfigWriteResult {
  id: string;
  replacement_case_id: string | null;
}
export interface OfficeState {
  observed_at: number;
  scanner_consensus_min?: number;
  group_consensus_min?: number;
  group_names?: string[];
  groups?: GroupSnapshot[];
  office: string;
  active: { id: string; status: string } | null;
  scanners: ScannerOutput[];
  last_processed_candle?: number;
  error: "MARKET_UNAVAILABLE" | null;
}
export interface ApiErrorBody {
  error: string;
  code?: string;
  details?: { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
}
