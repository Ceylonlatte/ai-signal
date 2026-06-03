import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../../db/client.js";
import { sources } from "../../../db/schema.js";
import { ingest } from "../../../ingest/ingest.js";
import { config } from "../../../config.js";
import type { RawPayload } from "../../../types.js";

export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  source: z.enum(["hn", "rss", "reddit", "twitter"]),
  externalId: z.string(),
  url: z.string().nullable(),
  author: z.string().nullable(),
  title: z.string(),
  text: z.string(),
  createdAt: z.string(),
  metrics: z.record(z.number()),
  raw: z.unknown(),
});
const bodySchema = z.object({
  source: z.enum(["hn", "rss", "reddit", "twitter"]),
  items: z.array(payloadSchema),
});

export async function POST(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${config.INGEST_TOKEN}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("bad request", { status: 400 });

  const { source, items } = parsed.data;
  let [src] = await db.select().from(sources).where(eq(sources.kind, source));
  if (!src) [src] = await db.insert(sources).values({ kind: source }).returning();

  const inserted = await ingest({ db, sourceId: src!.id, payloads: items as RawPayload[] });
  return Response.json({ inserted });
}
