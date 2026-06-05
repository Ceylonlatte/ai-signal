import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../../db/client.js";
import { keywords } from "../../../db/schema.js";
import { embedTexts } from "../../../lib/embeddings.js";

export const dynamic = "force-dynamic";

// Short all-caps ASCII tokens (AI, LLM, RAG) match case-sensitively so they
// don't fire inside ordinary words; everything else is case-insensitive.
function isAcronym(term: string): boolean {
  return /^[A-Z0-9][A-Z0-9.\-]{1,5}$/.test(term);
}

interface KeywordRow {
  id: number; term: string; enabled: boolean;
  caseSensitive: boolean; embedding: number[] | null;
}

function view(r: KeywordRow) {
  return { id: r.id, term: r.term, enabled: r.enabled, caseSensitive: r.caseSensitive, hasEmbedding: !!r.embedding };
}

const postSchema = z.object({ term: z.string().trim().min(1).max(80) });
const patchSchema = z.object({ id: z.number(), enabled: z.boolean() });
const deleteSchema = z.object({ id: z.number() });

export async function GET(): Promise<Response> {
  const rows = await db.select().from(keywords).orderBy(keywords.createdAt);
  return Response.json(rows.map((r) => view(r as KeywordRow)));
}

export async function POST(req: Request): Promise<Response> {
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("bad request", { status: 400 });
  const term = parsed.data.term;

  // Embed the term so semantic matching works immediately. Best-effort: if the
  // embeddings call fails we still store the keyword (exact-match only) and the
  // worker's lazy backfill embeds it later.
  let embedding: number[] | null = null;
  try { const [v] = await embedTexts([term]); embedding = v ?? null; } catch { /* backfilled later */ }

  const [row] = await db.insert(keywords)
    .values({ term, caseSensitive: isAcronym(term), embedding })
    .onConflictDoNothing({ target: keywords.term })
    .returning();
  return Response.json({ ok: true, created: row ? view(row as KeywordRow) : null });
}

export async function PATCH(req: Request): Promise<Response> {
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("bad request", { status: 400 });
  await db.update(keywords).set({ enabled: parsed.data.enabled }).where(eq(keywords.id, parsed.data.id));
  return Response.json({ ok: true });
}

export async function DELETE(req: Request): Promise<Response> {
  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("bad request", { status: 400 });
  await db.delete(keywords).where(eq(keywords.id, parsed.data.id));
  return Response.json({ ok: true });
}
