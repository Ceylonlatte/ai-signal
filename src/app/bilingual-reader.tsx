"use client";

import { useEffect, useState, type ReactNode } from "react";

// Both panes are rendered on the server and handed in as nodes; this component
// only owns the toggle, so react-markdown never ships to the client.

// Native radios (visually a segmented pill, like the search .seg): one tab
// stop, arrow keys cycle, screen readers announce a real radio group — honest
// semantics instead of the tablist this used to fake.
function Seg({
  name,
  options,
  value,
  onChange,
  label,
}: {
  name: string;
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <div className="kb-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label key={o.id} className="kb-seg__opt">
          <input
            type="radio"
            className="kb-seg__input"
            name={name}
            value={o.id}
            checked={value === o.id}
            onChange={() => onChange(o.id)}
          />
          <span className="kb-seg__face">{o.label}</span>
        </label>
      ))}
    </div>
  );
}

type BodyMode = "zh" | "orig" | "compare";
const BODY_MODE_KEY = "kb-body-mode";

export function BilingualBody({
  hasZh,
  zh,
  original,
}: {
  hasZh: boolean;
  zh: ReactNode;
  original: ReactNode;
}) {
  const [mode, setMode] = useState<BodyMode>(hasZh ? "compare" : "orig");

  // The mode is a preference, not per-visit state: restore the last choice, and
  // on narrow screens (where 对照 stacks into two full copies) default to 译文.
  // Runs once after hydration; SSR can't know viewport or storage.
  useEffect(() => {
    if (!hasZh) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(BODY_MODE_KEY);
    } catch {}
    if (saved === "zh" || saved === "orig" || saved === "compare") {
      setMode(saved);
    } else if (window.matchMedia("(max-width: 760px)").matches) {
      setMode("zh");
    }
  }, [hasZh]);

  function pick(m: BodyMode) {
    setMode(m);
    try {
      localStorage.setItem(BODY_MODE_KEY, m);
    } catch {}
  }

  return (
    <section className="kb-read" data-mode={mode}>
      <div className="kb-read__head">
        <h2 className="kb-sec-label">全文</h2>
        <span className="kb-sec-rule" />
        {hasZh && (
          <Seg
            name="kb-body-lang"
            label="正文语言"
            value={mode}
            onChange={(m) => pick(m as BodyMode)}
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
        <h2 className="kb-sec-label">讨论 · {count} 条</h2>
        <span className="kb-sec-rule" />
        {hasZh && (
          <Seg
            name="kb-disc-lang"
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
