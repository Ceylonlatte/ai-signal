import { db } from "../../db/client.js";
import { keywordSearch, semanticSearch } from "./search-queries.js";
import { sourceLabel, relativeTime } from "../format.js";
import { hostOf } from "../feed-item-data.js";

export const dynamic = "force-dynamic";

export default async function Search({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; mode?: string }>;
}) {
  const { q = "", mode = "keyword" } = await searchParams;
  const query = q.trim();
  const semantic = mode === "semantic";
  const results = query ? (semantic ? await semanticSearch(db, query) : await keywordSearch(db, query)) : [];
  const now = new Date();

  return (
    <main className="page">
      <div className="page__head">
        <h1 className="page__title">搜索</h1>
      </div>
      <p className="page__lead">
        你的个人记忆库：刷过的内容永久留存、随时可回溯。
        <em> 关键词</em> 精确匹配标题与正文，<em> 语义</em> 按含义召回相近内容。
      </p>

      <form className="search" role="search">
        <input
          className="field search__field"
          type="search"
          name="q"
          defaultValue={query}
          placeholder="搜索过往条目，如：上周关于 agent 的讨论"
          aria-label="搜索词"
          autoFocus
        />
        <span className="seg" role="radiogroup" aria-label="搜索模式">
          <label className="seg__opt">
            <input className="seg__input" type="radio" name="mode" value="keyword" defaultChecked={!semantic} />
            <span className="seg__face">关键词</span>
          </label>
          <label className="seg__opt">
            <input className="seg__input" type="radio" name="mode" value="semantic" defaultChecked={semantic} />
            <span className="seg__face">语义</span>
          </label>
        </span>
        <button className="btn btn--primary" type="submit">
          搜索
        </button>
      </form>

      {!query ? (
        <div className="placeholder">
          <p className="placeholder__title">搜索你的记忆</p>
          <p className="placeholder__body">
            输入关键词查找精确匹配，或切换到语义模式按含义检索。收藏与历史永不过期。
          </p>
        </div>
      ) : results.length === 0 ? (
        <div className="placeholder">
          <p className="placeholder__title">没有匹配「{query}」的结果</p>
          <p className="placeholder__body">
            换个说法，或试试{semantic ? "关键词" : "语义"}模式。
          </p>
        </div>
      ) : (
        <>
          <p className="search-hint">
            {semantic ? (
              <>语义匹配 · 共 {results.length} 条 · 仅覆盖已收录条目（被过滤的内容没有向量，请用关键词模式回溯）</>
            ) : (
              <>
                关键词匹配 · 共 {results.length} 条 · 已收录{" "}
                {results.filter((r: any) => r.accepted).length} / 已过滤{" "}
                {results.filter((r: any) => r.processed && !r.accepted).length}
              </>
            )}
          </p>
          <div className="results">
            {results.map((r: any) => {
              const host = hostOf(r.url ?? null);
              const sim = semantic && typeof r.dist === "number" ? Math.max(0, Math.round((1 - r.dist) * 100)) : null;
              return (
                <a
                  key={r.id}
                  className="result"
                  href={r.url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="result__title">{r.title}</span>
                  <span className="result__meta">
                    <span className="item__source">{sourceLabel(r.source)}</span>
                    {host && (
                      <>
                        <span className="meta-dot">·</span>
                        <span>{host}</span>
                      </>
                    )}
                    {r.createdAt && (
                      <>
                        <span className="meta-dot">·</span>
                        <span>{relativeTime(r.createdAt, now)}</span>
                      </>
                    )}
                    {sim !== null && (
                      <>
                        <span className="meta-dot">·</span>
                        <span className="result__sim">相似度 {sim}%</span>
                      </>
                    )}
                    {!r.processed ? (
                      <span className="tag tag--pending">待处理</span>
                    ) : r.accepted ? (
                      <span className="tag tag--accepted">已收录</span>
                    ) : (
                      <span className="tag tag--dropped">已过滤</span>
                    )}
                  </span>
                </a>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
