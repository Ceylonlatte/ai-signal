export default function Loading() {
  return (
    <main className="page is-static" aria-busy="true" aria-label="加载中">
      <div className="page__head">
        <h1 className="page__title">已压制</h1>
      </div>
      <p className="page__lead">
        这些条目因与你点踩过的内容相似而从信号流隐藏，但仍永久留存、可搜索。
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
