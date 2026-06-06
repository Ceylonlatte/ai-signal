export default function Loading() {
  return (
    <main className="page is-static" aria-busy="true" aria-label="加载中">
      <div className="page__head">
        <h1 className="page__title">话题趋势</h1>
      </div>
      <p className="page__lead">AI 圈正在聊的话题，按合成分排序。条形长度代表当日热度。</p>
      <div className="topics">
        {Array.from({ length: 10 }).map((_, i) => (
          <div className="topic" key={i}>
            <span className="topic__rank">{i + 1}</span>
            <span className="topic__body">
              <span className="skeleton-line" style={{ width: `${58 - i * 3}%`, maxWidth: 280 }} />
              <span className="topic__bar" aria-hidden="true" />
            </span>
          </div>
        ))}
      </div>
    </main>
  );
}
