import { z } from "zod";
import { providers, type Provider } from "./contracts";

export const keyProviders = providers.filter(
  (id): id is Exclude<Provider, "workers-ai"> => id !== "workers-ai",
);
export type KeyProvider = (typeof keyProviders)[number];
const keyProviderSchema = z.enum([
  "openai",
  "gemini",
  "groq",
  "openrouter",
  "mistral",
  "huggingface",
  "cohere",
  "nvidia",
]);
export const credentialWriteSchema = z.discriminatedUnion("action", [
  z
    .object({
      id: keyProviderSchema,
      action: z.literal("SAVE"),
      key: z
        .string()
        .trim()
        .min(8)
        .max(4096)
        .regex(
          /^[\x21-\x7e]+$/,
          "API key tidak boleh mengandung spasi atau baris baru",
        ),
      expectedVersion: z.string().uuid().nullable(),
    })
    .strict(),
  z
    .object({
      id: keyProviderSchema,
      action: z.literal("DELETE"),
      confirmed: z.literal(true),
      expectedVersion: z.string().uuid(),
    })
    .strict(),
]);
export type CredentialWrite = z.infer<typeof credentialWriteSchema>;
export interface CredentialStatus {
  id: Provider;
  configured: boolean;
  source: "UI" | "RUNTIME" | "BINDING" | "MISSING" | "LOCKED";
  version: string | null;
  updated_at: number | null;
}
export interface CredentialInventory {
  storage_ready: boolean;
  items: CredentialStatus[];
}
