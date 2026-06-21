export default function Loading() {
  return (
    <main className="page" aria-busy="true" aria-label="加载中">
      <div className="page__head page__head--bare">
        <h1 className="sr-only">信号流</h1>
      </div>
      <div className="feed">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton-item">
            <div className="skeleton-line" style={{ width: "72%" }} />
            <div className="skeleton-line" style={{ width: "94%", marginTop: 12 }} />
            <div className="skeleton-line" style={{ width: "40%", marginTop: 12 }} />
          </div>
        ))}
      </div>
    </main>
  );
}
