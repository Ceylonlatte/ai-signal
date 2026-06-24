// Detail-shaped loading skeleton. Without this, /library/[id] would fall back
// to the parent /library list skeleton ("收藏" + row stubs), flashing the wrong
// layout on the way into a reader. This mirrors the real kb-detail structure
// (back link · title · meta · save pill · note card · body) and inherits the
// same --kb-measure, so the skeleton → content handoff is seamless.
const line = (width: string, extra?: React.CSSProperties) => (
  <span className="skeleton-line" style={{ width, ...extra }} />
);

export default function Loading() {
  return (
    <main className="page kb-detail is-static" aria-busy="true" aria-label="加载中">
      <p className="kb-detail__back">{line("72px", { height: 12 })}</p>

      <div className="kb-detail__head">
        <div className="kb-detail__headmain">
          {line("90%", { height: 20 })}
          {line("58%", { height: 20, marginTop: 10 })}
          {line("240px", { height: 12, marginTop: 16 })}
        </div>
        <span
          className="skeleton-line"
          style={{ width: 88, height: 40, borderRadius: "var(--radius-pill)", flexShrink: 0 }}
        />
      </div>

      <div className="kb-note-shell">
        <div className="kb-note">
          {line("56px", { height: 11 })}
          {line("96%", { marginTop: 14 })}
          {line("93%", { marginTop: 10 })}
          {line("88%", { marginTop: 10 })}
          {line("64%", { marginTop: 10 })}
          {line("44px", { height: 11, marginTop: 28 })}
          {line("90%", { marginTop: 14 })}
          {line("82%", { marginTop: 10 })}
        </div>
      </div>

      <div className="kb-body">
        {line("64px", { height: 16 })}
        {line("97%", { marginTop: 16 })}
        {line("95%", { marginTop: 10 })}
        {line("91%", { marginTop: 10 })}
        {line("52%", { marginTop: 10 })}
      </div>
    </main>
  );
}
