// M4 Task 0 — embeddings feasibility spike (throwaway probe).
//
// RESULT (2026-06-03): SUCCESS. OpenRouter's /embeddings endpoint works with
// `nvidia/llama-nemotron-embed-vl-1b-v2:free` and returns vectors of
// dimension N = 2048. No local fallback needed. The pgvector columns use
// vector(2048); 2048 > pgvector's 2000-dim ANN-index limit, so there is NO
// ivfflat/hnsw index — semantic search/novelty/clustering use exact `<=>` scan.
//
// Run: set OPENROUTER_API_KEY + EMBEDDING_MODEL (from .env), then `tsx bin/spike-embeddings.ts`.
const MODEL = process.env.EMBEDDING_MODEL!;
async function main() {
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: ["hello world", "agentic coding"] }),
  });
  console.log("status", res.status);
  const text = await res.text();
  console.log(text.slice(0, 600));
  if (res.ok) {
    const data = JSON.parse(text);
    console.log("dimension:", data.data?.[0]?.embedding?.length);
  }
}
main();
