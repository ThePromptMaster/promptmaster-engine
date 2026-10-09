import { describe, expect, it } from 'vitest';

import { markdownToNotebook } from './notebook-export';

const CODE = 'import numpy as np\n\ndef x(t, gamma=0.1):\n    return np.exp(-gamma * t)  # __init__ stays\n\nassert abs(x(0) - 1) < 1e-12\nprint("PASS")';
const DOC = [
  '## Damped oscillator',
  '',
  'The motion obeys \\(m\\ddot{x} + c\\dot{x} + kx = 0\\); it costs $8,000.',
  '',
  '\\[ x(t) = e^{-\\gamma t}\\cos(\\omega_d t) \\]',
  '',
  '```python',
  CODE,
  '```',
  '',
  'Then a shell step:',
  '',
  '```bash',
  'pip install numpy',
  '```',
].join('\n');

type Nb = { cells: { cell_type: string; source: string[]; outputs?: unknown[]; execution_count?: unknown; id: string }[]; nbformat: number; nbformat_minor: number; metadata: { kernelspec: { name: string } } };
const parse = (s: string) => JSON.parse(s) as Nb;
const text = (c: { source: string[] }) => c.source.join('');

describe('Jupyter notebook export (L-62; Sean, 7 Oct, email 10)', () => {
  const nb = parse(markdownToNotebook(DOC, 'Physics & you'));

  it('is an nbformat 4.5 notebook with a Python kernel', () => {
    expect(nb.nbformat).toBe(4);
    expect(nb.nbformat_minor).toBe(5);
    expect(nb.metadata.kernelspec.name).toBe('python3');
    expect(new Set(nb.cells.map((c) => c.id)).size).toBe(nb.cells.length);
  });

  it('makes each Python block a code cell, byte for byte, with no claimed output', () => {
    const code = nb.cells.filter((c) => c.cell_type === 'code');
    expect(code).toHaveLength(1);
    expect(text(code[0])).toBe(CODE);
    expect(code[0].outputs).toEqual([]);
    expect(code[0].execution_count).toBeNull();
  });

  it('keeps prose in order around the code, mathematics in the form Jupyter renders', () => {
    expect(nb.cells.map((c) => c.cell_type)).toEqual(['markdown', 'markdown', 'code', 'markdown']);
    expect(text(nb.cells[0])).toBe('# Physics & you');
    const before = text(nb.cells[1]);
    expect(before).toContain('$m\\ddot{x} + c\\dot{x} + kx = 0$');
    expect(before).toContain('$$\nx(t) = e^{-\\gamma t}\\cos(\\omega_d t)\n$$');
    expect(before).toContain('it costs $8,000.');
  });

  it('leaves code in other languages as a fenced block in Markdown', () => {
    expect(text(nb.cells[3])).toContain('```bash\npip install numpy\n```');
  });

  it('a document with no code is one Markdown cell after the title', () => {
    const plain = parse(markdownToNotebook('Just prose.', ''));
    expect(plain.cells.map((c) => [c.cell_type, text(c)])).toEqual([['markdown', 'Just prose.']]);
  });
});
