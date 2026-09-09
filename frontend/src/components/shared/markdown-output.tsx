'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownOutputProps {
  content: string;
}

const components: Components = {
  table: ({ children }) => (
    <div className="overflow-x-auto -mx-2 px-2">
      <table className="min-w-full">{children}</table>
    </div>
  ),
};

export function MarkdownOutput({ content }: MarkdownOutputProps) {
  return (
    // `prose-slate` was the only `slate` reference outside components/ui/ —
    // and inert, since every colour it sets is overridden by a token utility
    // on the next line. Dropping it leaves the rendered output identical.
    <article className="prose prose-sm max-w-none prose-headings:text-[var(--on-surface)] prose-headings:font-semibold prose-p:text-[var(--on-surface)] prose-p:leading-relaxed prose-li:text-[var(--on-surface)] prose-strong:text-[var(--on-surface)] prose-a:text-[var(--pm-primary)] prose-code:text-[var(--pm-primary)] prose-code:bg-[var(--surface-container-low)] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.75rem] prose-pre:bg-[var(--surface-container-low)] prose-pre:rounded-xl prose-th:bg-[var(--surface-container-low)] prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:text-[0.75rem] prose-th:font-semibold prose-th:whitespace-nowrap prose-td:px-3 prose-td:py-2 prose-td:text-[0.875rem] prose-td:border-t prose-td:border-[var(--outline-variant)]/20">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </article>
  );
}
