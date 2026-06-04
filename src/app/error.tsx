"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="page">
      <div className="placeholder">
        <p className="placeholder__title">信号流加载失败</p>
        <p className="placeholder__body">
          可能是数据库或采集管道暂时不可用。
          <br />
          <button type="button" className="linkish" onClick={reset}>
            重试
          </button>
          {"　"}
          <a href="/status">查看流水线状态 →</a>
        </p>
      </div>
    </main>
  );
}
