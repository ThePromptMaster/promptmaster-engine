'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
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
import { useT } from '@/lib/i18n/i18n-provider';

interface MarkdownOutputProps {
  content: string;
}

/**
 * A wide table scrolls inside its own box, says so with a fade on the side
 * there is more, and keeps its first column in view (17 Oct, Sean, NORTHSTAR-2
 * on an iPad with the side chat open: the dates ran past the document pane).
 */
function TableScroll({ children }: { children: ReactNode }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
  }, []);
  return (
    <div className="relative -mx-2" data-table-scroll={edges.right || edges.left ? 'overflows' : undefined}>
      <div ref={ref} className="overflow-x-auto px-2">
        {/* The first column (the task, the item) stays put only while the rest scrolls. */}
        <table
          className={`min-w-full ${
            edges.left || edges.right
              ? '[&_td:first-child]:sticky [&_td:first-child]:left-0 [&_td:first-child]:max-w-[40%] [&_td:first-child]:bg-[var(--surface-container-lowest)] [&_th:first-child]:sticky [&_th:first-child]:left-0 [&_th:first-child]:z-[1]'
              : ''
          }`}
        >
          {children}
        </table>
      </div>
      {edges.left && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-[var(--surface-container-lowest)] to-transparent" />
      )}
      {edges.right && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[var(--surface-container-lowest)] to-transparent" />
      )}
      {edges.right && (
        <p className="mt-1 px-2 text-label text-[var(--on-surface-variant)] lg:hidden">{t('pnl.scrollTable')}</p>
      )}
    </div>
  );
}

const components: Components = {
  table: ({ children }) => <TableScroll>{children}</TableScroll>,
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
  const t = useT();
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
                {t('pnl.image', { alt: alt ?? '' })}
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
    <article className="prose prose-sm max-w-none prose-headings:text-[var(--on-surface)] prose-headings:font-semibold prose-p:text-[var(--on-surface)] prose-p:leading-relaxed prose-li:text-[var(--on-surface)] prose-strong:text-[var(--on-surface)] prose-a:text-[var(--pm-primary)] prose-code:text-[var(--pm-primary)] prose-code:bg-[var(--surface-container-low)] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.75rem] prose-pre:bg-[var(--surface-container-low)] prose-pre:rounded-xl prose-th:bg-[var(--surface-container-low)] prose-th:px-3 prose-th:py-2 prose-th:text-start prose-th:text-[0.75rem] prose-th:font-semibold prose-th:align-bottom prose-th:min-w-[6rem] prose-td:px-3 prose-td:align-top prose-td:min-w-[6rem] prose-td:py-2 prose-td:text-[0.875rem] prose-td:border-t prose-td:border-[var(--outline-variant)]/20">
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
