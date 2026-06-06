export default function Loading() {
  return (
    <main className="page is-static" aria-busy="true" aria-label="加载中">
      <div className="page__head">
        <h1 className="page__title">搜索</h1>
      </div>
      <p className="page__lead">你的个人记忆库：刷过的内容永久留存、随时可回溯。</p>
      <div className="search">
        <span className="skeleton-line search__field" style={{ height: 38 }} />
      </div>
      <div className="results">
        {Array.from({ length: 6 }).map((_, i) => (
          <div className="result" key={i}>
            <span className="skeleton-line" style={{ width: `${78 - i * 6}%` }} />
            <span className="skeleton-line" style={{ width: "32%", marginTop: 10 }} />
          </div>
        ))}
      </div>
    </main>
  );
}
