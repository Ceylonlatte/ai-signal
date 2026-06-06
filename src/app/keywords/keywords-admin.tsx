"use client";

import { useState } from "react";

export interface KeywordRow {
  id: number;
  term: string;
  enabled: boolean;
  caseSensitive: boolean;
  hasEmbedding: boolean;
}

export function KeywordsAdmin({ initial }: { initial: KeywordRow[] }) {
  const [rows, setRows] = useState<KeywordRow[]>(initial);
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const t = term.trim();
    if (!t || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/keywords", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ term: t }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { created } = await res.json();
      if (created) {
        setRows((rs) => (rs.some((r) => r.id === created.id) ? rs : [...rs, created]));
      }
      setTerm("");
    } catch {
      setErr("添加失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    const prev = rows;
    setRows((rs) => rs.filter((r) => r.id !== id));
    try {
      const res = await fetch("/api/keywords", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setRows(prev);
      setErr("删除失败，请重试");
    }
  }

  async function toggle(id: number, enabled: boolean) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, enabled } : r)));
    try {
      const res = await fetch("/api/keywords", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, enabled }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, enabled: !enabled } : r)));
      setErr("更新失败，请重试");
    }
  }

  return (
    <div>
      <form className="kw-form" onSubmit={add}>
        <input
          className="field kw-form__field"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="新增关键词，如：扩散模型 / Gemini / RAG"
          maxLength={80}
          aria-label="新增关键词"
        />
        <button className="btn btn--primary" type="submit" disabled={busy || !term.trim()}>
          {busy ? "添加中…" : "添加"}
        </button>
      </form>
      {err && (
        <p className="feed-error" role="alert">
          {err}
        </p>
      )}

      <p className="search-hint">共 {rows.length} 个关键词</p>

      {rows.length === 0 ? (
        <div className="placeholder">
          <p className="placeholder__title">还没有关键词</p>
          <p className="placeholder__body">添加一个开始，比如你正在关注的模型或方向。</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>关键词</th>
                <th>匹配</th>
                <th>语义向量</th>
                <th>启用</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ opacity: r.enabled ? 1 : 0.55 }}>
                  <td className="kw-cell-term">{r.term}</td>
                  <td className="muted">{r.caseSensitive ? "区分大小写" : "不区分大小写"}</td>
                  <td>
                    <span className={`badge${r.hasEmbedding ? " badge--on" : ""}`}>
                      <span className="badge__dot" aria-hidden="true" />
                      {r.hasEmbedding ? "已生成" : "待生成"}
                    </span>
                  </td>
                  <td>
                    <span className="switch">
                      <input
                        className="switch__input"
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) => toggle(r.id, e.target.checked)}
                        aria-label={`${r.enabled ? "停用" : "启用"} ${r.term}`}
                      />
                      <span className="switch__track" aria-hidden="true" />
                    </span>
                  </td>
                  <td className="num">
                    <button type="button" className="btn-danger" onClick={() => remove(r.id)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
