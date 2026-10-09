'use client';

import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';

import { normalizeMath } from '@/lib/markdown/math';
import { rehypeTexSource, type HastNode } from '@/lib/markdown/hast';
import { CodeBlock, MathDisplay } from './code-block';

import { IMAGE_SCHEME } from '@/lib/data/images';
import { useProjectImageUrls } from './project-images';

interface MarkdownOutputProps {
  content: string;
}

const components: Components = {
  table: ({ children }) => (
    <div className="overflow-x-auto -mx-2 px-2">
      <table className="min-w-full">{children}</table>
    </div>
  ),
  // M1 (8 Oct): code with its language, Copy and Download; equations with Copy LaTeX.
  pre: ({ node, children }) => <CodeBlock node={node as unknown as HastNode}>{children}</CodeBlock>,
  div: ({ node, children, ...rest }) => {
    const tex = (node?.properties as { dataTex?: unknown } | undefined)?.dataTex;
    if (typeof tex === 'string') return <MathDisplay tex={tex}>{children}</MathDisplay>;
    return <div {...rest}>{children}</div>;
  },
};

// Single-dollar maths is off: a "$" is money far more often than maths, and
// `normalizeMath` turns the LaTeX ones into "$$" first.
const REMARK = [remarkGfm, [remarkMath, { singleDollarTextMath: false }]] as const;
const REHYPE = [[rehypeKatex, { throwOnError: false, strict: false }], [rehypeHighlight, { detect: false, plainText: ['txt', 'text', 'plaintext', 'output'] }], rehypeTexSource] as const;

/** `project-file:<id>` survives sanitising; it is resolved when drawn. */
function urlTransform(url: string): string {
  return url.startsWith(IMAGE_SCHEME) ? url : defaultUrlTransform(url);
}

export function MarkdownOutput({ content }: MarkdownOutputProps) {
  const imageUrls = useProjectImageUrls();
  const withImages: Components = {
    ...components,
    img: ({ src, alt }) => {
      const raw = typeof src === 'string' ? src : '';
      if (raw.startsWith(IMAGE_SCHEME)) {
        const url = imageUrls[raw.slice(IMAGE_SCHEME.length)];
        return (
          <span className="my-4 block" data-project-image>
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived link; next/image would need its host configured
              <img src={url} alt={alt ?? ''} className="block max-h-[420px] rounded-lg" />
            ) : (
              <span className="block rounded-lg bg-[var(--surface-container-low)] px-4 py-6 text-center text-label text-[var(--on-surface-variant)]">
                Image: {alt}
              </span>
            )}
            {alt && <span className="mt-1 block text-label text-[var(--on-surface-variant)]">{alt}</span>}
          </span>
        );
      }
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={raw} alt={alt ?? ''} />;
    },
  };
  return (
    // `prose-slate` was the only `slate` reference outside components/ui/ —
    // and inert, since every colour it sets is overridden by a token utility
    // on the next line. Dropping it leaves the rendered output identical.
    <article className="prose prose-sm max-w-none prose-headings:text-[var(--on-surface)] prose-headings:font-semibold prose-p:text-[var(--on-surface)] prose-p:leading-relaxed prose-li:text-[var(--on-surface)] prose-strong:text-[var(--on-surface)] prose-a:text-[var(--pm-primary)] prose-code:text-[var(--pm-primary)] prose-code:bg-[var(--surface-container-low)] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.75rem] prose-pre:bg-[var(--surface-container-low)] prose-pre:rounded-xl prose-th:bg-[var(--surface-container-low)] prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:text-[0.75rem] prose-th:font-semibold prose-th:whitespace-nowrap prose-td:px-3 prose-td:py-2 prose-td:text-[0.875rem] prose-td:border-t prose-td:border-[var(--outline-variant)]/20">
      <ReactMarkdown
        remarkPlugins={REMARK as never}
        rehypePlugins={REHYPE as never}
        components={withImages}
        urlTransform={urlTransform}
      >
        {normalizeMath(content)}
      </ReactMarkdown>
    </article>
  );
}
