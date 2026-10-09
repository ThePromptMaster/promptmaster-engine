/**
 * Mathematics in model output, made into one form the renderer reads (M1, 8 Oct).
 *
 * Sean, 6–7 Oct: "Equations had stray commas, missing equals signs, visible
 * LaTeX markup"; "the default should show readable equations, including
 * fractions, matrices, subscripts, Greek letters, and longer derivations,
 * without strange symbols or exposed formatting commands."
 *
 * Models write maths as \( … \), \[ … \], $ … $ and $$ … $$. The renderer
 * (remark-math with single-dollar maths switched off) reads $$ … $$ only,
 * because a single dollar is far more often money: "$8,000 and $9,000" must
 * stay two amounts. So, outside code:
 *   - \[ … \] becomes a display block, \( … \) inline maths;
 *   - $ … $ becomes maths only when what it holds is plainly LaTeX — a
 *     command, a sub/superscript, braces, an equals sign — or a lone letter.
 * Pure. The saved text is never rewritten; this runs when it is drawn.
 */

const FENCE = /^(\s*)(```|~~~)/;

/** Text outside fenced and inline code, transformed; code left exactly as it is. */
function outsideCode(text: string, transform: (prose: string) => string): string {
  const out: string[] = [];
  let buffer: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (buffer.length) out.push(transformInline(buffer.join('\n'), transform));
    buffer = [];
  };
  for (const line of text.split('\n')) {
    const m = line.match(FENCE);
    if (fence) {
      out.push(line);
      if (m && m[2] === fence) fence = null;
      continue;
    }
    if (m) {
      flush();
      fence = m[2];
      out.push(line);
      continue;
    }
    buffer.push(line);
  }
  flush();
  return out.join('\n');
}

/** Inline `code` spans are left alone too. */
function transformInline(prose: string, transform: (p: string) => string): string {
  return prose
    .split(/(`[^`\n]+`)/)
    .map((piece, i) => (i % 2 === 1 ? piece : transform(piece)))
    .join('');
}

const LATEX_HINT = /[\\^_{}=]/;

export function normalizeMath(text: string): string {
  if (!text) return text;
  return outsideCode(text, (prose) =>
    prose
      // \[ … \] → a display block on its own lines.
      .replace(/\\\[([\s\S]+?)\\\]/g, (_m, body: string) => `\n$$\n${body.trim()}\n$$\n`)
      // \( … \) → inline maths.
      .replace(/\\\(([\s\S]+?)\\\)/g, (_m, body: string) => `$$${body.trim()}$$`)
      // $ … $ that is plainly LaTeX → inline maths. Never money: "$8,000 and $9,000".
      .replace(/(?<![$\\\d])\$(?!\$)(?=\S)([^$\n]{1,400}?)(?<=\S)\$(?![$\d])/g, (m, body: string) =>
        LATEX_HINT.test(body) || /^[A-Za-z]$/.test(body.trim()) ? `$$${body}$$` : m
      )
  );
}

/** The display equations in a text, as their LaTeX: what "Copy LaTeX" and the .tex export use. */
export function displayEquations(text: string): string[] {
  return [...normalizeMath(text).matchAll(/^\$\$\n([\s\S]+?)\n\$\$$/gm)].map((m) => m[1]);
}
