import { z } from "zod";

const schema = z.object({
  // Default lets `config` import without throwing in tests; the real connection
  // string is read directly from process.env.DATABASE_URL in src/db/client.ts.
  DATABASE_URL: z.string().url().default("postgres://aisignal:aisignal@localhost:5432/aisignal"),
  TEST_DATABASE_URL: z.string().url().optional(),
  INGEST_TOKEN: z.string().min(1).default("dev-token"),
  BASIC_AUTH_USER: z.string().default("admin"),
  BASIC_AUTH_PASS: z.string().default("admin"),
  OPENROUTER_API_KEY: z.string().default(""),
  SCORING_MODEL: z.string().default("deepseek/deepseek-v4-flash"),
  EMBEDDING_MODEL: z.string().default("nvidia/llama-nemotron-embed-vl-1b-v2:free"),
  WEIGHT_HEAT: z.coerce.number().default(0.2),
  WEIGHT_RELEVANCE: z.coerce.number().default(0.2),
  WEIGHT_NOVELTY: z.coerce.number().default(0.15),
  WEIGHT_LLM: z.coerce.number().default(0.45),
  // --- Quality gate Q (time-invariant, llm-dominant) ---
  Q_THRESHOLD: z.coerce.number().default(0.55),
  Q_WEIGHT_REL: z.coerce.number().default(0.15),
  Q_WEIGHT_TRUST: z.coerce.number().default(0.15),
  // --- Ranking R (live) ---
  R_WEIGHT_Q: z.coerce.number().default(0.45),
  R_WEIGHT_HEAT: z.coerce.number().default(0.30),
  R_WEIGHT_NOVELTY: z.coerce.number().default(0.10),
  R_WEIGHT_AFFINITY: z.coerce.number().default(0.15),
  // --- Per-platform heat log-normalization divisors ---
  HEAT_K_HN: z.coerce.number().default(2.5),
  HEAT_K_REDDIT: z.coerce.number().default(2.5),
  HEAT_K_TWITTER: z.coerce.number().default(3.5),
  // --- Feedback profile ---
  SUPPRESS_THRESHOLD: z.coerce.number().default(0.92),
  RESCUE_SIM_THRESHOLD: z.coerce.number().default(0.85),
  RESCUE_MARGIN: z.coerce.number().default(0.10),
  COLDSTART_N0: z.coerce.number().default(5),
  PROFILE_WINDOW_DAYS: z.coerce.number().default(90),
  // --- Summarize stage ---
  SUMMARY_MAX_ATTEMPTS: z.coerce.number().default(3),
});

export const config = schema.parse(process.env);

export const weights = {
  heat: config.WEIGHT_HEAT,
  relevance: config.WEIGHT_RELEVANCE,
  novelty: config.WEIGHT_NOVELTY,
  llm: config.WEIGHT_LLM,
};

export const qualityWeights = {
  wRel: config.Q_WEIGHT_REL,
  wTrust: config.Q_WEIGHT_TRUST,
};

export const rankingWeights = {
  wQ: config.R_WEIGHT_Q,
  wHeat: config.R_WEIGHT_HEAT,
  wNov: config.R_WEIGHT_NOVELTY,
  wAff: config.R_WEIGHT_AFFINITY,
};
