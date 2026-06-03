import { db } from "../../db/client.js";
import { keywordSearch, semanticSearch } from "./search-queries.js";

export const dynamic = "force-dynamic";

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string; mode?: string }> }) {
  const { q = "", mode = "keyword" } = await searchParams;
  const results = q ? (mode === "semantic" ? await semanticSearch(db, q) : await keywordSearch(db, q)) : [];
  return (
    <main style={{ maxWidth: 760, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>Search</h1>
      <form>
        <input name="q" defaultValue={q} placeholder="search..." />
        <select name="mode" defaultValue={mode}>
          <option value="keyword">keyword</option>
          <option value="semantic">semantic</option>
        </select>
        <button type="submit">Go</button>
      </form>
      <ul>
        {results.map((r: any) => (
          <li key={r.id}><a href={r.url ?? "#"} target="_blank" rel="noreferrer">{r.title}</a> <small>{r.source}</small></li>
        ))}
      </ul>
    </main>
  );
}
