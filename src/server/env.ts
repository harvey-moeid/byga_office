export interface Env {
  DB: D1Database;
  CHART_DB: D1Database;
  OFFICE: DurableObjectNamespace;
  ASSETS: Fetcher;
  APP_ENV: string;
  PUBLIC_ORIGIN: string;
  CHART_SCHEMA: string;
  ADMIN_PASSWORD_HASH?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  MISTRAL_API_KEY?: string;
  HF_TOKEN?: string;
  COHERE_API_KEY?: string;
  NVIDIA_API_KEY?: string;
  DISCORD_MEETING_WEBHOOK?: string;
  DISCORD_SIGNAL_WEBHOOK?: string;
}
