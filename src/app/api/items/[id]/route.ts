import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../../../../db/client.js";
import { items, kbEntries } from "../../../../db/schema.js";

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
  // The star only moves items in/out of the favorites list — the knowledge-base
  // entry is permanent memory and survives unfavoriting (design principle:
  // nothing valuable is ever lost). Re-favoriting resets a `failed` entry so
  // runKbStage retries it (otherwise the attempts cap would exclude it forever).
  if (parsed.data.isFavorited === true) {
    await db
      .update(kbEntries)
      .set({ attempts: 0, status: "pending", error: null })
      .where(and(eq(kbEntries.itemId, Number(id)), eq(kbEntries.status, "failed")));
  }
  return Response.json({ ok: true });
}
