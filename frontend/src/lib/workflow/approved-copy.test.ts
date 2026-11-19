import { describe, expect, it } from 'vitest';

import { approvedBody, approvedSources, sourceAskedFor, withApprovedCopy } from './approved-copy';
import { countWords } from './measurable';
import { copiesApproved, findingRisk } from './triage';

/**
 * 19 Nov (Sean, Scanner Readiness): "I approved Staff announcement v1, but the
 * readiness package still used an older copy in Section 6." Two repairs told "word
 * for word" each paraphrased it.
 */
const ANNOUNCEMENT = [
  '# Staff announcement',
  '',
  'From Monday 1 December every picker uses the new handheld scanner. Training runs in six sessions of at most eight people on 25, 26 and 27 November.',
  'Your supervisor will give you your session time. Please do not swap sessions without telling your supervisor.',
  '',
  'Word count: 104',
].join('\n');

const template = {
  stages: [
    { id: 'announcement', label: 'Announcement', short_label: 'Staff announcement', exit_criteria: [{ id: 'announcement.approved', label: 'I approve this announcement', check: 'manual' }] },
    { id: 'check', label: 'Check', exit_criteria: [] },
    { id: 'package', label: 'Package', exit_criteria: [{ id: 'package.approved', label: 'I approve the package', check: 'manual' }] },
  ],
} as never;
const bundles = { announcement: { artifact: null, versions: [{ id: 'v1', version_number: 1, content: ANNOUNCEMENT }] } } as never;

const PACKAGE = [
  '# Readiness package',
  '## 5. Dependencies',
  'IT confirms the scanners on 24 November.',
  '## 6. Staff announcement',
  'From Monday every picker uses the new scanner. Each session holds at most eight people. (104 words)',
  '## 7. Approvals',
  'R14: Section 6 carries the approved staff announcement.',
].join('\n');

const FINDING = 'Section 6 uses an older copy. Replace section 6 with the approved Staff announcement v1, word for word, and show its word count.';

describe('an approved text is copied word for word, by code', () => {
  it('reads the approved stage without its title or count line', () => {
    const [source] = approvedSources(template, bundles, { 'announcement.approved': true }, { 'announcement.approved': 'v1' });
    expect(source.text.startsWith('From Monday 1 December')).toBe(true);
    expect(source.text).not.toContain('Word count');
    expect(approvedBody(ANNOUNCEMENT, ['Announcement', 'Staff announcement'])).toBe(source.text);
    expect(approvedSources(template, bundles, {}, {})).toEqual([]);
  });

  it('replaces the section the finding names, and counts its words in code', () => {
    const [source] = approvedSources(template, bundles, { 'announcement.approved': true });
    expect(sourceAskedFor(FINDING, [source], 'package')).toBe(source);
    expect(sourceAskedFor('Tighten section 6.', [source], 'package')).toBeNull();
    const out = withApprovedCopy(PACKAGE, source, FINDING)!;
    const words = countWords(source.text);
    expect(out.words).toBe(words);
    expect(out.content).toContain(`## 6. Staff announcement\n\n${source.text}\n\n*${words} words, counted`);
    expect(out.content).not.toContain('(104 words)');
    expect(out.content).toContain('## 7. Approvals');
    expect(out.content).toContain('## 5. Dependencies\nIT confirms');
    // Done once: the section already holds it.
    expect(withApprovedCopy(out.content, source, FINDING)).toBeNull();
  });

  it('a finding asking for an approved text word for word is routine, whatever its severity', () => {
    const row = { id: 'i1', severity: 'major', finding: 'Section 6 uses an older copy of the announcement.', suggested_change: 'Copy the approved Staff announcement v1 verbatim.' };
    expect(copiesApproved(row)).toBe(true);
    expect(findingRisk(row, { fields: [{ key: 'severity', options: ['minor', 'major'] }] } as never)).toBe('routine');
    expect(copiesApproved({ id: 'i2', suggested_change: 'Rewrite the announcement more warmly.' })).toBe(false);
  });
});
