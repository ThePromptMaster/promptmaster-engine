/**
 * The work as a Jupyter notebook (L-62, 9 Oct; Sean, 7 Oct, email 10: "export
 * mathematical work … as a notebook").
 *
 * Pure: Markdown in, an nbformat 4.5 `.ipynb` out. Each fenced Python block
 * becomes a code cell, byte for byte, so the notebook runs as it stands;
 * everything between them becomes a Markdown cell. Mathematics is put in the
 * form Jupyter renders — `$…$` inline, `$$…$$` on lines of their own — and
 * never re-typed. Code in other languages stays a fenced block in Markdown,
 * since the notebook's kernel is Python. No outputs are included: a notebook
 * claims a result only when it has been run.
 */

import { normalizeMath } from '@/lib/markdown/math';

interface Cell {
  cell_type: 'markdown' | 'code';
  id: string;
  metadata: Record<string, never>;
  source: string[];
  execution_count?: null;
  outputs?: never[];
}

const PYTHON = new Set(['python', 'py', 'python3', 'ipython']);

/** nbformat stores source as lines, each ending in "\n" but the last. */
function lines(text: string): string[] {
  const parts = text.split('\n');
  return parts.map((l, i) => (i < parts.length - 1 ? `${l}\n` : l)).filter((l, i, a) => !(i === a.length - 1 && l === ''));
}

/** Inline `$$x$$` (the renderer's form) as Jupyter's `$x$`; display blocks are left as they are. */
function jupyterMath(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => (line.trim() === '$$' ? line : line.replace(/\$\$([^$\n]+?)\$\$/g, (_m, tex: string) => `$${tex}$`)))
    .join('\n');
}

export function markdownToNotebook(markdown: string, title: string): string {
  const cells: Cell[] = [];
  const markdownCell = (text: string) => {
    const body = text.replace(/^\n+|\n+$/g, '');
    if (body.trim()) cells.push({ cell_type: 'markdown', id: `md-${cells.length + 1}`, metadata: {}, source: lines(jupyterMath(body)) });
  };
  const codeCell = (code: string) => {
    cells.push({ cell_type: 'code', id: `code-${cells.length + 1}`, metadata: {}, execution_count: null, outputs: [], source: lines(code) });
  };

  if (title.trim()) markdownCell(`# ${title.trim()}`);
  let prose: string[] = [];
  let fence: { marker: string; lang: string; lines: string[] } | null = null;
  for (const raw of normalizeMath(markdown.replace(/\r\n?/g, '\n')).split('\n')) {
    if (fence) {
      if (raw.trim().startsWith(fence.marker)) {
        if (PYTHON.has(fence.lang)) {
          markdownCell(prose.join('\n'));
          prose = [];
          codeCell(fence.lines.join('\n'));
        } else {
          prose.push(`${fence.marker}${fence.lang}`, ...fence.lines, fence.marker);
        }
        fence = null;
      } else fence.lines.push(raw);
      continue;
    }
    const opens = /^\s*(```|~~~)\s*([\w+-]*)/.exec(raw);
    if (opens) {
      fence = { marker: opens[1], lang: opens[2].toLowerCase(), lines: [] };
      continue;
    }
    prose.push(raw);
  }
  // An unclosed fence keeps its text rather than losing it.
  if (fence) {
    const open = fence as { marker: string; lang: string; lines: string[] };
    if (PYTHON.has(open.lang)) {
      markdownCell(prose.join('\n'));
      prose = [];
      codeCell(open.lines.join('\n'));
    } else prose.push(`${open.marker}${open.lang}`, ...open.lines);
  }
  markdownCell(prose.join('\n'));

  const notebook = {
    cells,
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python' },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
  return `${JSON.stringify(notebook, null, 1)}\n`;
}
