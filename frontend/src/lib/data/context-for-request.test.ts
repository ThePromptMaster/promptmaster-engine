// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { CONTEXT_REQUEST_CHARS, changeWindow, contextForRequest, termsOf } from './context-for-request';

const para = (i: number, extra = '') => `Paragraph ${i}. ${'Plain filler words about nothing in particular. '.repeat(20)}${extra}`;

function manuscript(n: number, special: Record<number, string> = {}): string {
  return ['### From book.docx', ...Array.from({ length: n }, (_, i) => para(i, special[i] ?? ''))].join('\n\n');
}

describe('what one request carries of a long manuscript (15 Nov: 417,000 characters cut to 200,000)', () => {
  it('sends a text that fits whole and unchanged', () => {
    const text = manuscript(10);
    expect(contextForRequest(text, 'anything')).toEqual({ context: text, read: text.length, total: text.length, passages: 0 });
  });

  it('sends the opening and the passages that match the step, in order, within the limit, and says how much', () => {
    const text = manuscript(440, { 350: 'The Regge discriminant lift closes the gate.', 120: 'Calibration of the axial monodromy.' });
    expect(text.length).toBeGreaterThan(400_000);
    const out = contextForRequest(text, 'discriminant lift and axial monodromy', 120_000);
    expect(out.context.length).toBeLessThanOrEqual(120_000);
    expect(out.total).toBe(text.length);
    expect(out.context).toMatch(/^\[The project's material is [\d,]+ characters, all kept\. This request carries [\d,]+ of them/);
    expect(out.context).toContain('Paragraph 0.');
    expect(out.context).toContain('The Regge discriminant lift closes the gate.');
    expect(out.context).toContain('Calibration of the axial monodromy.');
    expect(out.context.indexOf('axial monodromy')).toBeLessThan(out.context.indexOf('discriminant lift closes'));
    expect(out.context).toMatch(/\[… [\d,]+ characters not included in this request …\]/);
    expect(out.passages).toBeGreaterThan(0);
  });

  it('names the document a passage comes from when its heading was left out', () => {
    const text = `${manuscript(200)}\n\n### From notes.md\n\n${Array.from({ length: 200 }, (_, i) => para(i, i === 150 ? 'zebrafish telemetry' : '')).join('\n\n')}`;
    const out = contextForRequest(text, 'zebrafish telemetry', 100_000);
    expect(out.context).toContain('(from notes.md)');
    expect(out.context).toContain('zebrafish telemetry');
  });

  it('caps every request at the backend limit by default', () => {
    expect(CONTEXT_REQUEST_CHARS).toBe(200_000);
    expect(contextForRequest('x'.repeat(900_000), '').context.length).toBeLessThanOrEqual(200_000);
  });

  it('matches on words of four letters or more and on numbers', () => {
    const terms = termsOf('The Regge measure of 2026 is $570 and on');
    expect(terms.has('regge') && terms.has('measure') && terms.has('2026') && terms.has('570')).toBe(true);
    expect(terms.has('the') || terms.has('and')).toBe(false);
  });

  it('compares only the changed part of a long field', () => {
    const before = 'a'.repeat(300_000) + 'OLD' + 'b'.repeat(300_000);
    const after = 'a'.repeat(300_000) + 'NEW' + 'b'.repeat(300_000);
    const w = changeWindow(before, after);
    expect(w.before.length).toBeLessThan(10_000);
    expect(w.before).toContain('OLD');
    expect(w.after).toContain('NEW');
    expect(changeWindow('short', 'shorter')).toEqual({ before: 'short', after: 'shorter' });
  });
});
