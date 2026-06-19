import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../../../db/client.js";
import { items, kbEntries } from "../../../../db/schema.js";
import { deletePrefix, r2Configured } from "../../../../lib/kb/r2.js";

export const dynamic = "force-dynamic";

const schema = z.object({
  isFavorited: z.boolean().optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("bad request", { status: 400 });

  const patch: Record<string, unknown> = {};
  if (parsed.data.isFavorited !== undefined) {
    patch.isFavorited = parsed.data.isFavorited;
    patch.favoritedAt = parsed.data.isFavorited ? new Date() : null;
  }
  if (Object.keys(patch).length === 0) return new Response("no-op", { status: 400 });

  await db.update(items).set(patch).where(eq(items.id, Number(id)));
  // Unfavoriting drops the knowledge-base entry AND its transferred images:
  // prevents orphan rows + orphan R2 objects, and lets a later re-favorite
  // reprocess from scratch (a `failed` entry would otherwise be permanently
  // excluded by runKbStage's attempts cap). R2 cleanup is best-effort.
  if (parsed.data.isFavorited === false) {
    await db.delete(kbEntries).where(eq(kbEntries.itemId, Number(id)));
    if (r2Configured()) {
      await deletePrefix(`kb/${Number(id)}/`).catch((e) => console.error("r2 cleanup failed", id, e));
    }
  }
  return Response.json({ ok: true });
}
