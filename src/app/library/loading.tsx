export default function Loading() {
  return (
    <main className="page is-static" aria-busy="true" aria-label="加载中">
      <div className="page__head">
        <h1 className="page__title">收藏</h1>
      </div>
      <p className="page__lead">
        点 ⭐ 存入的内容会在这里整理成知识库笔记，可点开看全文与结构化摘要。
      </p>
      <div className="lib-shell">
        <div className="lib-panel">
          <div className="lib-group">
            <div className="lib-group__label">
              <b>今天</b>
              <span className="lib-group__rule" aria-hidden="true" />
            </div>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="lib-row">
                <span className="lib-row__orb" aria-hidden="true">
                  <i />
                </span>
                <div className="lib-row__body">
                  <span className="skeleton-line" style={{ width: `${68 - i * 6}%` }} />
                  <span className="skeleton-line" style={{ width: "90%", marginTop: 12 }} />
                  <span className="skeleton-line" style={{ width: "32%", marginTop: 12 }} />
                </div>
                <div className="lib-row__aside" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
