import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>;
}

// Show the Chinese rendering by default; keep the original one click away in a
// <details> so there's no client JS. `zh` is empty when the source was already
// Chinese (or translation was skipped), in which case we just render the original.
export function TranslatedBlock({ zh, original }: { zh: string | null; original: string }) {
  const hasZh = Boolean(zh && zh.trim());
  return (
    <>
      <div className="markdown">
        <Markdown>{hasZh ? zh! : original}</Markdown>
      </div>
      {hasZh && (
        <details className="kb-original">
          <summary>查看原文</summary>
          <div className="markdown">
            <Markdown>{original}</Markdown>
          </div>
        </details>
      )}
    </>
  );
}
