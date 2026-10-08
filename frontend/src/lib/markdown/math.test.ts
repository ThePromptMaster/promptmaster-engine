import { describe, expect, it } from 'vitest';

import { displayEquations, normalizeMath } from './math';

describe('maths in model output (M1; Sean, 7 Oct)', () => {
  it('\\[ \\] becomes a display block and \\( \\) inline maths', () => {
    expect(normalizeMath('So \\(x_1 = 0.5\\) and\n\\[ E = \\frac{1}{2} m v^2 \\]\ndone')).toBe('So $$x_1 = 0.5$$ and\n\n$$\nE = \\frac{1}{2} m v^2\n$$\n\ndone');
  });

  it('$ … $ is maths only when it is plainly LaTeX; money is left alone', () => {
    expect(normalizeMath('Energy $E = mc^2$ and $\\gamma$ and $x$.')).toBe('Energy $$E = mc^2$$ and $$\\gamma$$ and $$x$$.');
    expect(normalizeMath('B + D + E costs $10,000; A + B costs $8,000 and $9,000.')).toBe('B + D + E costs $10,000; A + B costs $8,000 and $9,000.');
    expect(normalizeMath('Between $5 and $10 per seat.')).toBe('Between $5 and $10 per seat.');
  });

  it('never touches code, fenced or inline', () => {
    const code = '```python\nprice = "$x_1$"\nprint(f"\\(a\\)")\n```\nand `$y^2$` here';
    expect(normalizeMath(code)).toBe(code);
  });

  it('leaves $$ blocks as they are and lists display equations', () => {
    const t = 'Text\n$$\n\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}\n$$\nmore';
    expect(normalizeMath(t)).toBe(t);
    expect(displayEquations(t)).toEqual(['\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}']);
  });
});
