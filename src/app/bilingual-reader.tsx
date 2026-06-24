"use client";

import { useState, type ReactNode } from "react";

// Both panes are rendered on the server and handed in as nodes; this component
// only owns the toggle, so react-markdown never ships to the client.
function Seg({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <div className="kb-seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          data-on={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function BilingualBody({
  hasZh,
  zh,
  original,
}: {
  hasZh: boolean;
  zh: ReactNode;
  original: ReactNode;
}) {
  const [mode, setMode] = useState<"zh" | "orig" | "compare">(hasZh ? "compare" : "orig");

  return (
    <section className="kb-read" data-mode={mode}>
      <div className="kb-read__head">
        <span className="kb-sec-label">全文</span>
        <span className="kb-sec-rule" />
        {hasZh && (
          <Seg
            label="正文语言"
            value={mode}
            onChange={(m) => setMode(m as typeof mode)}
            options={[
              { id: "zh", label: "译文" },
              { id: "orig", label: "原文" },
              { id: "compare", label: "对照" },
            ]}
          />
        )}
      </div>

      {mode === "compare" ? (
        <div className="kb-compare">
          <div className="kb-compare__col">
            <div className="kb-compare__label">译文</div>
            {zh}
          </div>
          <div className="kb-compare__col kb-compare__col--orig">
            <div className="kb-compare__label">原文</div>
            {original}
          </div>
        </div>
      ) : (
        <div className="kb-read__body">{mode === "zh" ? zh : original}</div>
      )}
    </section>
  );
}

export function BilingualDiscussion({
  count,
  hasZh,
  zh,
  original,
}: {
  count: number;
  hasZh: boolean;
  zh: ReactNode;
  original: ReactNode;
}) {
  const [mode, setMode] = useState<"zh" | "orig">(hasZh ? "zh" : "orig");

  return (
    <section className="kb-read kb-disc">
      <div className="kb-read__head">
        <span className="kb-sec-label">讨论 · {count} 条</span>
        <span className="kb-sec-rule" />
        {hasZh && (
          <Seg
            label="讨论语言"
            value={mode}
            onChange={(m) => setMode(m as typeof mode)}
            options={[
              { id: "zh", label: "译文" },
              { id: "orig", label: "原文" },
            ]}
          />
        )}
      </div>
      <div className="kb-read__body">{mode === "zh" ? zh : original}</div>
    </section>
  );
}
