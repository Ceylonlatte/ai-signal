export default function Loading() {
  return (
    <main className="page is-static" aria-busy="true" aria-label="加载中">
      <div className="page__head">
        <h1 className="page__title">话题趋势</h1>
      </div>
      <p className="page__lead">AI 圈正在讨论的话题，按当日热度排序。</p>
      <div className="dash">
        <div className="stat">
          <div className="stat__label">今日话题</div>
          <span className="skeleton-line" style={{ width: 40, height: 24, marginTop: 6 }} />
        </div>
        <div className="stat">
          <div className="stat__label">总热度</div>
          <span className="skeleton-line" style={{ width: 56, height: 24, marginTop: 6 }} />
        </div>
        <div className="stat">
          <div className="stat__label">最热话题</div>
          <span className="skeleton-line" style={{ width: "70%", height: 16, marginTop: 8 }} />
        </div>
      </div>
      <ol className="lite">
        {Array.from({ length: 10 }).map((_, i) => (
          <li key={i}>
            <div className="lite-row">
              <span className="lite-row__rank">{String(i + 1).padStart(2, "0")}</span>
              <span className="lite-row__label">
                <span
                  className="skeleton-line"
                  style={{ width: `${64 - i * 3}%`, maxWidth: 320 }}
                />
              </span>
              <span className="lite-row__bar" aria-hidden="true" />
              <span className="lite-row__metrics">
                <span className="skeleton-line" style={{ width: 30, height: 13 }} />
              </span>
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}
