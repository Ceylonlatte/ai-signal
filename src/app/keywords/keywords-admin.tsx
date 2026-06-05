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
      <form onSubmit={add} style={{ display: "flex", gap: 8, margin: "1rem 0" }}>
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="新增关键词，如：扩散模型 / Gemini / RAG"
          maxLength={80}
          style={{ flex: 1, padding: "8px 10px", fontSize: 14, border: "1px solid #ccc", borderRadius: 6 }}
        />
        <button
          type="submit"
          disabled={busy || !term.trim()}
          style={{ padding: "8px 16px", fontSize: 14, borderRadius: 6, border: "1px solid #3b82f6", background: "#3b82f6", color: "#fff", cursor: "pointer" }}
        >
          {busy ? "添加中…" : "添加"}
        </button>
      </form>
      {err && <p style={{ color: "#b91c1c", fontSize: 13 }}>{err}</p>}

      <p style={{ color: "#888", fontSize: 13 }}>共 {rows.length} 个关键词</p>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#888", fontSize: 12 }}>
            <th style={{ padding: "6px 8px" }}>关键词</th>
            <th style={{ padding: "6px 8px" }}>匹配</th>
            <th style={{ padding: "6px 8px" }}>语义</th>
            <th style={{ padding: "6px 8px" }}>启用</th>
            <th style={{ padding: "6px 8px" }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderTop: "1px solid #eee", opacity: r.enabled ? 1 : 0.5 }}>
              <td style={{ padding: "6px 8px", fontWeight: 500 }}>{r.term}</td>
              <td style={{ padding: "6px 8px", color: "#666" }}>{r.caseSensitive ? "区分大小写" : "不区分"}</td>
              <td style={{ padding: "6px 8px", color: r.hasEmbedding ? "#16a34a" : "#b45309" }}>
                {r.hasEmbedding ? "已生成" : "待生成"}
              </td>
              <td style={{ padding: "6px 8px" }}>
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={(e) => toggle(r.id, e.target.checked)}
                  aria-label={`启用 ${r.term}`}
                />
              </td>
              <td style={{ padding: "6px 8px", textAlign: "right" }}>
                <button
                  type="button"
                  onClick={() => remove(r.id)}
                  style={{ border: "none", background: "none", color: "#b91c1c", cursor: "pointer", fontSize: 13 }}
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: "16px 8px", color: "#999" }}>
                还没有关键词，添加一个开始。
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
