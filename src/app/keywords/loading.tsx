export default function Loading() {
  return (
    <main className="page is-static" aria-busy="true" aria-label="加载中">
      <div className="page__head">
        <h1 className="page__title">关键词</h1>
      </div>
      <p className="page__lead">
        关键词同时用于预筛（决定哪些条目送 LLM 打分）和相关性打分。改动在后台 worker 最多 60 秒内生效。
      </p>
      <div className="kw-form">
        <span className="skeleton-line kw-form__field" style={{ height: 38 }} />
        <span className="skeleton-line" style={{ width: 84, height: 38 }} />
      </div>
      <div className="table-wrap" style={{ marginTop: "var(--space-4)" }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton-item" style={{ padding: "var(--space-3)" }}>
            <span className="skeleton-line" style={{ width: `${50 - i * 4}%` }} />
          </div>
        ))}
      </div>
    </main>
  );
}
