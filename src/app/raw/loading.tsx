export default function Loading() {
  return (
    <main className="page is-static" aria-busy="true" aria-label="加载中">
      <div className="page__head">
        <h1 className="page__title">原始采集</h1>
      </div>
      <p className="page__lead">
        去重后入库的原始条目（raw_items），按平台分类、原文直出，不参与打分与排序。
      </p>
      <div className="feed">
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
