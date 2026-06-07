export default function Loading() {
  return (
    <main className="page is-static" aria-busy="true" aria-label="加载中">
      <div className="page__head">
        <h1 className="page__title">收藏</h1>
      </div>
      <p className="page__lead">
        这里收录你点过 👍 的内容，按最近点赞时间排列，方便长期回看。
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
