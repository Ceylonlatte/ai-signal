export default function Loading() {
  return (
    <main className="page is-static" aria-busy="true" aria-label="加载中">
      <div className="page__head">
        <h1 className="page__title">收藏</h1>
      </div>
      <p className="page__lead">
        点 ⭐ 存入的内容会在这里整理成知识库笔记，可点开看全文与结构化摘要。
      </p>
      <div className="results">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton-item">
            <span className="skeleton-line" style={{ width: `${72 - i * 5}%` }} />
            <span className="skeleton-line" style={{ width: "92%", marginTop: 12 }} />
            <span className="skeleton-line" style={{ width: "28%", marginTop: 12 }} />
          </div>
        ))}
      </div>
    </main>
  );
}
