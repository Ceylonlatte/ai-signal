import { z } from "zod";
import { db } from "../../../db/client.js";
import { feedback } from "../../../db/schema.js";

export const dynamic = "force-dynamic";

const schema = z.object({
  itemId: z.number(),
  signal: z.enum(["up", "down"]),
  reason: z.string().optional(),
});

export async function POST(req: Request): Promise<Response> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("bad request", { status: 400 });
  await db.insert(feedback).values(parsed.data);
  return Response.json({ ok: true });
}
