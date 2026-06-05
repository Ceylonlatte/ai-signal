import { db } from "../../db/client.js";
import { keywords } from "../../db/schema.js";
import { KeywordsAdmin, type KeywordRow } from "./keywords-admin.js";

export const dynamic = "force-dynamic";

export default async function Keywords() {
  const rows = await db.select().from(keywords).orderBy(keywords.createdAt);
  const data: KeywordRow[] = rows.map((r: any) => ({
    id: r.id, term: r.term, enabled: r.enabled,
    caseSensitive: r.caseSensitive, hasEmbedding: !!r.embedding,
  }));
  return (
    <main style={{ maxWidth: 760, margin: "2rem auto", fontFamily: "system-ui", padding: "0 1rem" }}>
      <h1>关键词</h1>
      <p style={{ color: "#666", fontSize: 14, lineHeight: 1.6 }}>
        关键词同时用于<strong>预筛</strong>（决定哪些条目送 LLM 打分）和<strong>相关性打分</strong>。
        新增的词会自动生成向量：命中精确词、<em>或</em>语义相近的内容都会被判为相关，
        因此不必穷举同义词。改动在后台 worker 最多 60 秒内生效。
      </p>
      <KeywordsAdmin initial={data} />
    </main>
  );
}
