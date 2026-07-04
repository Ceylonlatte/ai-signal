import { z } from "zod";

const schema = z.object({
  // Default lets `config` import without throwing in tests; the real connection
  // string is read directly from process.env.DATABASE_URL in src/db/client.ts.
  DATABASE_URL: z.string().url().default("postgres://aisignal:aisignal@localhost:5432/aisignal"),
  TEST_DATABASE_URL: z.string().url().optional(),
  INGEST_TOKEN: z.string().min(1).default("dev-token"),
  // --- 仪表盘登录（Google / NextAuth）---
  // 实际由 NextAuth 与 src/auth.config.ts 直接读取 process.env，这里登记仅为集中校验与文档。
  AUTH_SECRET: z.string().default(""),
  AUTH_GOOGLE_ID: z.string().default(""),
  AUTH_GOOGLE_SECRET: z.string().default(""),
  // 允许登录的 Google 邮箱白名单（逗号分隔）；为空 = 拒绝所有人（安全默认）。
  AUTH_ALLOWED_EMAILS: z.string().default(""),
  OPENROUTER_API_KEY: z.string().default(""),
  SCORING_MODEL: z.string().default("deepseek/deepseek-v4-flash"),
  EMBEDDING_MODEL: z.string().default("qwen/qwen3-embedding-8b"),
  // qwen3-embedding-8b is natively 4096-dim; we request a 2048-dim MRL slice so
  // vectors fit the `vector(2048)` columns. MUST equal the schema dimension.
  EMBEDDING_DIM: z.coerce.number().default(2048),
  WEIGHT_HEAT: z.coerce.number().default(0.2),
  WEIGHT_RELEVANCE: z.coerce.number().default(0.2),
  WEIGHT_NOVELTY: z.coerce.number().default(0.15),
  WEIGHT_LLM: z.coerce.number().default(0.45),
  // --- Quality gate Q (time-invariant, llm-dominant) ---
  Q_THRESHOLD: z.coerce.number().default(0.55),
  // Lower gate for twitter "following": a hand-curated timeline we trust more,
  // so it clears the bar more easily than the global threshold. Tunable.
  Q_THRESHOLD_TWITTER_FOLLOWING: z.coerce.number().default(0.45),
  // Raised 0.15 → 0.30: keyword/semantic relevance now weighs more in Q.
  Q_WEIGHT_REL: z.coerce.number().default(0.30),
  Q_WEIGHT_TRUST: z.coerce.number().default(0.15),
  // Semantic relevance: cosine sim at/below this floor contributes nothing; the
  // [floor, 1] range is linearly mapped to [0, 1]. Tunable via env.
  RELEVANCE_SIM_THRESHOLD: z.coerce.number().default(0.45),
  // --- Ranking R (live) ---
  R_WEIGHT_Q: z.coerce.number().default(0.45),
  R_WEIGHT_HEAT: z.coerce.number().default(0.30),
  R_WEIGHT_NOVELTY: z.coerce.number().default(0.10),
  R_WEIGHT_AFFINITY: z.coerce.number().default(0.15),
  // Subtracted from R, scaled by similarity to recently disliked items, so
  // content like what you 👎'd ranks lower (soft demotion, not a hard hide).
  R_WEIGHT_DISLIKE: z.coerce.number().default(0.15),
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
  // --- Knowledge base (收藏 → KB) ---
  FIRECRAWL_API_KEY: z.string().default(""),
  R2_ACCOUNT_ID: z.string().default(""),
  R2_ACCESS_KEY_ID: z.string().default(""),
  R2_SECRET_ACCESS_KEY: z.string().default(""),
  R2_BUCKET: z.string().default(""),
  R2_PUBLIC_BASE_URL: z.string().default(""),
  KB_FETCH_LIMIT: z.coerce.number().default(5),
  KB_MAX_ATTEMPTS: z.coerce.number().default(3),
  KB_MAX_IMAGE_BYTES: z.coerce.number().default(5_000_000),
  KB_MIN_BODY_CHARS: z.coerce.number().default(400),
  KB_NOTE_INPUT_CHARS: z.coerce.number().default(12000),
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
  wDislike: config.R_WEIGHT_DISLIKE,
};
