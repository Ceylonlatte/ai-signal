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
});

export const config = schema.parse(process.env);

export const weights = {
  heat: config.WEIGHT_HEAT,
  relevance: config.WEIGHT_RELEVANCE,
  novelty: config.WEIGHT_NOVELTY,
  llm: config.WEIGHT_LLM,
};
