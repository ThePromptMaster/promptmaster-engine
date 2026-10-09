import { describe, expect, it } from 'vitest';

import { escapeLatex, markdownToLatex } from './latex-export';
import { markdownToBlocks } from './docx-export';

const CODE = 'def fib(n):\n    a, b = 0, 1  # __init__ style_names stay\n    for _ in range(n):\n        a, b = b, a + b\n    return a';
const DOC = [
  '# Damped oscillator',
  '',
  'The motion obeys \\(m\\ddot{x} + c\\dot{x} + kx = 0\\), so **energy** falls; it costs $8,000 & 5% of the budget.',
  '',
  '$$',
  '\\begin{aligned} x(t) &= e^{-\\gamma t}\\cos(\\omega_d t) \\\\ \\omega_d &= \\sqrt{\\omega_0^2 - \\gamma^2} \\end{aligned}',
  '$$',
  '',
  '```python',
  CODE,
  '```',
  '',
  '- first `a_i`',
  '- second',
].join('\n');

describe('LaTeX export (M2; Sean, 7 Oct)', () => {
  const tex = markdownToLatex(DOC, 'Physics & you');

  it('is a complete document with amsmath', () => {
    expect(tex.startsWith('\\documentclass[11pt]{article}')).toBe(true);
    expect(tex).toContain('\\usepackage{amsmath,amssymb}');
    expect(tex).toContain('\\title{Physics \\& you}');
    expect(tex.trimEnd().endsWith('\\end{document}')).toBe(true);
  });

  it('carries the mathematics through exactly as written', () => {
    expect(tex).toContain('\\(m\\ddot{x} + c\\dot{x} + kx = 0\\)');
    expect(tex).toContain('\\[\n\\begin{aligned} x(t) &= e^{-\\gamma t}\\cos(\\omega_d t) \\\\ \\omega_d &= \\sqrt{\\omega_0^2 - \\gamma^2} \\end{aligned}\n\\]');
  });

  it('keeps code byte for byte, and escapes prose', () => {
    expect(tex).toContain(`\\begin{verbatim}\n${CODE}\n\\end{verbatim}`);
    expect(tex).toContain('\\textbf{energy}');
    expect(tex).toContain('\\$8,000 \\& 5\\% of the budget');
    expect(tex).toContain('\\item first \\verb|a_i|');
    expect(tex).toContain('\\section*{Damped oscillator}');
    expect(escapeLatex('a_b{c}~')).toBe('a\\_b\\{c\\}\\textasciitilde{}');
  });
});

describe('Word export keeps code and equations (M2)', () => {
  it('a fenced block is one code block, every line and indent intact', () => {
    const blocks = markdownToBlocks(DOC);
    expect(blocks.find((b) => b.kind === 'code')).toEqual({ kind: 'code', text: CODE, language: 'python' });
    expect(blocks.find((b) => b.kind === 'math')?.text).toContain('\\omega_d &= \\sqrt');
    // No "# comment" became a heading, and underscores in inline code survive.
    expect(blocks.filter((b) => b.kind === 'title')).toHaveLength(1);
    expect(blocks.find((b) => b.kind === 'bullet')?.text).toBe('first a_i');
  });
});
