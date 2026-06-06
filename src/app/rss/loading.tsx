export default function Loading() {
  return (
    <main className="page is-static" aria-busy="true" aria-label="加载中">
      <div className="page__head">
        <h1 className="page__title">RSS 订阅</h1>
      </div>
      <p className="page__lead">
        来自各家官方博客 / 发布说明的 RSS 源，每 24 小时全量抓取一次、仅保留近两天发布的条目，不参与打分与 LLM 处理，原文直出。
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
