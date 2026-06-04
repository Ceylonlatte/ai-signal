import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../../db/client.js";
import { sources } from "../../../db/schema.js";
import { ingest } from "../../../ingest/ingest.js";
import { mapDigestItems } from "../../../lib/sources/digest-map.js";
import { config } from "../../../config.js";

export const dynamic = "force-dynamic";

// The digest skills POST RAW source items here; we map them server-side so the
// skills stay collect-only. (hn/rss ingest directly via bin/, not this route.)
const bodySchema = z.object({
  source: z.enum(["reddit", "twitter"]),
  feed: z.string().optional(),
  items: z.array(z.record(z.unknown())).max(2000),
});

export async function POST(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${config.INGEST_TOKEN}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("bad request", { status: 400 });

  const { source, feed, items } = parsed.data;
  const payloads = mapDigestItems(source, feed, items);

  let [src] = await db.select().from(sources).where(eq(sources.kind, source));
  if (!src) [src] = await db.insert(sources).values({ kind: source }).returning();

  const inserted = await ingest({ db, sourceId: src!.id, payloads });
  // Record freshness so the dashboard's stale-source banner is accurate for
  // these Mac-pushed sources, which only arrive via this route.
  await db.update(sources).set({ lastRunAt: new Date() }).where(eq(sources.id, src!.id));
  return Response.json({ inserted, mapped: payloads.length });
}
