export default function Loading() {
  return (
    <main className="page is-static" aria-busy="true" aria-label="加载中">
      <div className="page__head">
        <h1 className="page__title">流水线状态</h1>
      </div>
      <p className="page__lead">采集 → 入库 → 打分 → 向量 → 摘要 → 聚类的实时进度。本页每 5 秒自动刷新。</p>

      <div className="pipe-shell">
        <div className="pipe">
          {Array.from({ length: 6 }).map((_, i) => (
            <div className={`pipe__step${i < 3 ? " is-done" : ""}`} key={i}>
              <div className="pipe__spine" aria-hidden="true">
                <span className="pipe__node" />
                {i < 5 && <span className="pipe__seg" />}
              </div>
              <div className="pipe__cap">
                <div className="pipe__head">
                  <span className="skeleton-line" style={{ width: `${30 + (i % 3) * 8}%`, maxWidth: 240 }} />
                </div>
                <div className="bar" aria-hidden="true" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="stats" style={{ marginTop: "var(--space-10)" }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div className="stat" key={i}>
            <span className="skeleton-line" style={{ width: "60%", height: 12 }} />
            <span className="skeleton-line" style={{ width: "48%", height: 22, marginTop: 10 }} />
          </div>
        ))}
      </div>
    </main>
  );
}
