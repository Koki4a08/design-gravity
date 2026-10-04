import { Fragment } from "react";

// **bold**, *italic* / _italic_, `code`. Enough for agent replies; no block markdown.
const TOKEN = /(\*\*[^*\n]+?\*\*|`[^`\n]+?`|\*[^*\s][^*\n]*?\*|\b_[^_\n]+?_\b)/g;

/** Agent text with its light inline markdown rendered instead of shown raw. */
export function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(TOKEN).map((part, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
        if (part.startsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (part.startsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
        return <em key={i}>{part.slice(1, -1)}</em>;
      })}
    </>
  );
}
