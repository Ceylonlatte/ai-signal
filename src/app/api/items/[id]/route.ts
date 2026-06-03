import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../../../db/client.js";
import { items } from "../../../../db/schema.js";

export const dynamic = "force-dynamic";

const schema = z.object({
  isFavorited: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  read: z.boolean().optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("bad request", { status: 400 });

  const patch: Record<string, unknown> = {};
  if (parsed.data.isFavorited !== undefined) patch.isFavorited = parsed.data.isFavorited;
  if (parsed.data.isArchived !== undefined) patch.isArchived = parsed.data.isArchived;
  if (parsed.data.read !== undefined) patch.readAt = parsed.data.read ? new Date() : null;
  if (Object.keys(patch).length === 0) return new Response("no-op", { status: 400 });

  await db.update(items).set(patch).where(eq(items.id, Number(id)));
  return Response.json({ ok: true });
}
