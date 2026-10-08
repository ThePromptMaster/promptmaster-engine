/**
 * The work as a LaTeX document (M2, 8 Oct; Sean, 7 Oct: "Users should be able
 * to copy the underlying LaTeX and export mathematical work as LaTeX or a
 * readable PDF").
 *
 * Pure: Markdown in, a complete .tex file out, that compiles with pdflatex and
 * amsmath. Mathematics is carried through as written — never re-typed — and
 * code goes into `verbatim`, so every character and every indent survives.
 * Prose is escaped for LaTeX; headings, lists, bold and italics map to their
 * LaTeX forms. Tables are kept as their Markdown text in `verbatim` rather than
 * guessed into `tabular`; images become a comment naming their caption.
 */

import { normalizeMath } from '@/lib/markdown/math';

const SPECIAL: Record<string, string> = {
  '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&', '#': '\\#',
  '%': '\\%', '_': '\\_', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}',
};

/** Escape prose for LaTeX. */
export function escapeLatex(text: string): string {
  return text.replace(/[\\{}$&#%_^~]/g, (c) => SPECIAL[c]);
}

/** One line of prose: maths and code kept exactly, the rest escaped, emphasis mapped. */
function inlineLatex(text: string): string {
  const kept: string[] = [];
  const keep = (s: string) => `\u0000${kept.push(s) - 1}\u0000`;
  const marked = text
    .replace(/`([^`]+)`/g, (_m, code: string) => keep(`\\verb${delimiterFor(code)}${code}${delimiterFor(code)}`))
    .replace(/\$\$([^$]+)\$\$/g, (_m, tex: string) => keep(`\\(${tex}\\)`))
    .replace(/!\[([^\]]*)\]\(project-file:[^)]*\)/g, (_m, caption: string) => keep(`[Image: ${escapeLatex(caption)}]`))
    .replace(/\[([^\]]+)\]\(([^)]*)\)/g, (_m, label: string, url: string) => keep(`${escapeLatex(label)}\\footnote{\\url{${url}}}`));
  return escapeLatex(marked)
    .replace(/\*\*(.+?)\*\*/g, '\\textbf{$1}')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1\\emph{$2}')
    .replace(/\u0000(\d+)\u0000/g, (_m, i: string) => kept[Number(i)]);
}

/** A delimiter for \verb that the code does not contain. */
function delimiterFor(code: string): string {
  return ['|', '!', '+', '@', '=', ';'].find((d) => !code.includes(d)) ?? '|';
}

const HEADINGS = ['\\section*', '\\section', '\\subsection', '\\subsubsection', '\\paragraph', '\\paragraph'];

export function markdownToLatex(markdown: string, title: string): string {
  const body: string[] = [];
  let list: string[] | null = null;
  let fence: { marker: string; lines: string[] } | null = null;
  let math: string[] | null = null;
  let table: string[] | null = null;
  const closeList = () => {
    if (list) body.push('\\begin{itemize}', ...list.map((i) => `  \\item ${i}`), '\\end{itemize}', '');
    list = null;
  };
  const closeTable = () => {
    if (table) body.push('\\begin{verbatim}', ...table, '\\end{verbatim}', '');
    table = null;
  };

  for (const raw of normalizeMath(markdown.replace(/\r\n?/g, '\n')).split('\n')) {
    if (fence) {
      if (raw.trim().startsWith(fence.marker)) {
        body.push('\\begin{verbatim}', ...fence.lines, '\\end{verbatim}', '');
        fence = null;
      } else fence.lines.push(raw);
      continue;
    }
    if (math) {
      if (raw.trim() === '$$') {
        // An environment of its own (aligned, gather…) inside \[ \] is what amsmath expects.
        body.push('\\[', ...math, '\\]', '');
        math = null;
      } else math.push(raw);
      continue;
    }
    const opens = /^\s*(```|~~~)/.exec(raw);
    if (opens) {
      closeList();
      closeTable();
      fence = { marker: opens[1], lines: [] };
      continue;
    }
    if (raw.trim() === '$$') {
      closeList();
      closeTable();
      math = [];
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(raw)) {
      closeList();
      (table ??= []).push(raw);
      continue;
    }
    closeTable();
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw.trimEnd());
    if (heading) {
      closeList();
      body.push(`${HEADINGS[heading[1].length - 1]}{${inlineLatex(heading[2])}}`, '');
      continue;
    }
    const bullet = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(raw);
    if (bullet) {
      (list ??= []).push(inlineLatex(bullet[1]));
      continue;
    }
    if (!raw.trim()) {
      closeList();
      if (body.at(-1) !== '') body.push('');
      continue;
    }
    closeList();
    body.push(inlineLatex(raw.trim()));
  }
  closeList();
  closeTable();
  if (fence) body.push('\\begin{verbatim}', ...(fence as { lines: string[] }).lines, '\\end{verbatim}');
  if (math) body.push('\\[', ...(math as string[]), '\\]');

  return [
    '\\documentclass[11pt]{article}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage{amsmath,amssymb}',
    '\\usepackage{url}',
    '\\usepackage[margin=1in]{geometry}',
    `\\title{${escapeLatex(title)}}`,
    '\\date{}',
    '\\begin{document}',
    '\\maketitle',
    '',
    ...body,
    '\\end{document}',
    '',
  ].join('\n');
}
