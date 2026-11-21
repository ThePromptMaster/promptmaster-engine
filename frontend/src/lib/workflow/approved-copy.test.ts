import { describe, expect, it } from 'vitest';

import { approvedBody, approvedCopiesFor, approvedSources, sourceAskedFor, withApprovedCopy, wordsToWrite } from './approved-copy';
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

describe('a copy already there keeps a count counted in code (19 Nov production pass)', () => {
  const [source] = approvedSources(template, bundles, { 'announcement.approved': true });
  const words = countWords(source.text);
  it('a hand count beside it is corrected', () => {
    const quoted = `# Package\n## 6. Staff announcement\n*Reproduced as approved. Length: 698 words.*\n\n> ${source.text.split('\n').join('\n> ')}\n## 7. Approvals\nDone.`;
    const out = withApprovedCopy(quoted, source, FINDING)!;
    expect(out.content).toContain(`Length: ${words} words (counted).`);
    expect(out.content).toContain('## 7. Approvals');
    expect(withApprovedCopy(out.content, source, FINDING)).toBeNull();
  });
  it('with no count, one is added under the heading', () => {
    const plain = `## 6. Staff announcement\n\n${source.text}\n## 7. Approvals`;
    expect(withApprovedCopy(plain, source, FINDING)!.content).toContain(`## 6. Staff announcement\n\n*${words} words, counted`);
  });
});

describe('the copied text sits inside its section (19 Nov production pass)', () => {
  const rec = { stageId: 'recommendation', label: 'Recommendation', shortLabel: '', version: 4, text: '## Recommended vendor: Vendor A\n\nInstallation time decides it.\n\n## Why installation time decides it\n\nA installs in 3 weeks.' };
  const finding = 'The package Recommendation section must be the approved Recommendation text copied word for word.';
  it('its headings are nested under the section heading, and a second save changes nothing', () => {
    const pkg = '# Package\n## 3. Recommendation\nParaphrase.\n## 4. Still to do\nWarranty.';
    const once = withApprovedCopy(pkg, rec, finding)!;
    expect(once.content).toContain('## 3. Recommendation\n\n### Recommended vendor: Vendor A');
    expect(once.content).toContain('### Why installation time decides it');
    expect(once.content).toContain('## 4. Still to do');
    expect(withApprovedCopy(once.content, rec, finding)).toBeNull();
  });
  it('a copy left at the section\'s own level is nested, not copied again', () => {
    const flat = `## 3. Recommendation\n\n${rec.text}\n\n*${countWords(rec.text)} words, counted.*\n## 4. Still to do\nWarranty.`;
    const out = withApprovedCopy(flat, rec, finding)!;
    expect(out.content.match(/Recommended vendor: Vendor A/g)).toHaveLength(1);
    expect(out.content).toContain('### Recommended vendor: Vendor A');
    expect(out.content).toContain('## 4. Still to do\nWarranty.');
    expect(withApprovedCopy(out.content, rec, finding)).toBeNull();
  });
});

/**
 * 21 Nov (Sean, launch readiness brief and internal email, L-267): every save of the
 * final put Internal email v5 back over the Target line accepted change i19 asked
 * for, because row i1 ("Keep them verbatim in the final brief and email") was read
 * as a request to copy the approved email. The strings are production's.
 */
describe('the copy never undoes the work (21 Nov, L-267)', () => {
  const EMAIL_V5 = [
    '**Subject:** Inventory rollout: launch not authorized',
    '',
    'Hi all,',
    '',
    "**QA:** The required inventory reconciliation check passed on its Thursday 10 a.m. rerun, after failing Wednesday at 2 p.m. Tuesday's pass was withdrawn.",
    '',
    '**Launch:** Not authorized; launch cannot proceed yet. The release manager withdrew the Thursday 8 a.m. authorization at 10:15 a.m. and is reviewing.',
    '',
    '**Decision owner:** The release manager. The decision is open.',
    '',
    '**Target:** Friday at 9 a.m.',
  ].join('\n');
  const TARGET_I19 = '**Target:** Friday at 9 a.m., kept by the release manager while reviewing; this is not an authorization.';
  const i1 = {
    id: 'i1',
    finding: 'Line-by-line comparison of the four statuses found no conflict. QA: brief "All required checks passed, as reported by the QA lead on Tuesday at 10 a.m." matches the email word for word. Launch: brief "Launch cannot proceed yet" matches email "not authorized and cannot proceed yet". Owner: both say "The release manager decides whether to authorize launch." Target: both say "Friday at 9 a.m."',
    suggested_change: 'No change to these four statements. Keep them verbatim in the final brief and email.',
  };
  const i19 = {
    id: 'i19',
    finding: 'Email, Target line: "**Target:** Friday at 9 a.m." The brief says the target is "kept as the target while the release manager reviews" and cites the 10:15 a.m. message. The email gives no evidence for the target.',
    suggested_change: `In the shortened email, write: "${TARGET_I19}"`,
  };
  const copyRow = { id: 'i30', finding: 'The final email differs from the approved one.', suggested_change: 'Use the approved Internal email word for word in the final.' };
  const tpl = {
    stages: [
      { id: 'internal_email', label: 'Internal email', short_label: 'Email', exit_criteria: [{ id: 'internal_email.approved', label: 'I approve this email', check: 'manual' }] },
      { id: 'consistency_and_fact_check', label: 'Consistency and fact check', short_label: 'Check', exit_criteria: [] },
      { id: 'final_brief_and_email', label: 'Final brief and email', short_label: 'Final', exit_criteria: [] },
    ],
  } as never;
  const final = (email: string) => `# Launch Readiness Brief\n\n**Target launch:** Friday at 9 a.m.\n\n# Internal Email\n\n${email}\n`;
  const repaired = final(EMAIL_V5.replace('**Target:** Friday at 9 a.m.', TARGET_I19));
  const current = { internal_email: { artifact: null, versions: [{ id: 'e5', version_number: 5, content: EMAIL_V5 }] } } as never;
  const sourcesOnHead = approvedSources(tpl, current, { 'internal_email.approved': true }, { 'internal_email.approved': 'e5' });

  it('a "keep these statements verbatim" row copies nothing: it does not ask for an approved text', () => {
    expect(sourceAskedFor(`${i1.finding} ${i1.suggested_change}`, sourcesOnHead, 'final_brief_and_email')).toBeNull();
    const out = approvedCopiesFor(repaired, [i1, i19], sourcesOnHead, 'final_brief_and_email');
    expect(out.content).toBe(repaired);
    expect(out.notes).toEqual([]);
  });

  it('an approval given on an earlier version than the stage\'s current one is not copied', () => {
    const later = { internal_email: { artifact: null, versions: [{ id: 'e5', version_number: 5, content: EMAIL_V5 }, { id: 'e6', version_number: 6, content: EMAIL_V5 }] } } as never;
    const [source] = approvedSources(tpl, later, { 'internal_email.approved': true }, { 'internal_email.approved': 'e5' });
    expect(source.outdated).toEqual({ head: 6 });
    const out = approvedCopiesFor(repaired, [copyRow, i19], [source], 'final_brief_and_email');
    expect(out.content).toBe(repaired);
    expect(out.notes[0]).toContain('Internal email: approved on v5, now v6, so not copied word for word until that approval is re-confirmed (i30)');
  });

  it('a copy that would take away another accepted change is not made, and says which', () => {
    const out = approvedCopiesFor(repaired, [copyRow, i19], sourcesOnHead, 'final_brief_and_email');
    expect(out.content).toContain(TARGET_I19);
    expect(out.notes).toEqual(['Internal email v5 not copied over the text: accepted change i19 changes it (i30)']);
  });

  it('a paraphrase is still replaced, with no count line in the work', () => {
    const paraphrased = final(EMAIL_V5.replace('The decision is open.', 'No decision yet.'));
    const out = approvedCopiesFor(paraphrased, [copyRow], sourcesOnHead, 'final_brief_and_email');
    expect(out.content).toContain('**Decision owner:** The release manager. The decision is open.');
    expect(out.content).not.toMatch(/words, counted/);
    expect(out.notes[0]).toMatch(/^Internal email v5 as approved, word for word, \d+ words counted in code \(i30\)$/);
    // Done once.
    expect(approvedCopiesFor(out.content, [copyRow], sourcesOnHead, 'final_brief_and_email').notes).toEqual([]);
  });

  it('the count line an earlier copy put in the work is taken out (production v16)', () => {
    const v16 = final(`*67 words, counted — Internal email v5 as approved.*\n\n${EMAIL_V5.replace('**Target:** Friday at 9 a.m.', TARGET_I19)}`);
    const out = approvedCopiesFor(v16, [i1, i19], sourcesOnHead, 'final_brief_and_email');
    expect(out.content).toBe(repaired);
    expect(out.notes).toEqual(['took out the count line an earlier copy put in the work']);
    const v15 = final(`${EMAIL_V5}\n\n*67 words, counted — Internal email v5 as approved, copied word for word.*\n`);
    expect(approvedCopiesFor(v15, [i1], sourcesOnHead, 'final_brief_and_email').content).not.toContain('words, counted');
  });

  it('the words a change asks to write are its quoted text, not what it asks to remove', () => {
    expect(wordsToWrite(i19.suggested_change)).toEqual([TARGET_I19]);
    expect(wordsToWrite('Replace "the old target line here" with "Friday at 9 a.m., kept while reviewing"')).toEqual(['Friday at 9 a.m., kept while reviewing']);
    expect(wordsToWrite('Remove "the italic line at the end of the email"')).toEqual([]);
    expect(wordsToWrite('Say "yes"')).toEqual([]);
  });
});

/**
 * 21 Nov hand pass (john@ c89649d5): the check's fixes to the email are "e.g. …" and
 * the writer words them its own way, so the words to write can't be looked for. A row
 * that quotes a line of the approved text as it stands is about changing it.
 */
describe('a copy waits while an accepted row changes the approved text (21 Nov hand pass)', () => {
  const EMAIL = [
    '**Subject: Inventory rollout: launch status**',
    '',
    'Team,',
    '',
    '**Target:** Friday at 9 a.m. remains the target while the release manager reviews. It is not a confirmed launch.',
    '',
    '**Decision owner:** the release manager.',
  ].join('\n');
  const source = { stageId: 'internal_email', label: 'Internal email', shortLabel: 'Email', text: EMAIL, version: 1 };
  const copyRow = { id: 'i9', finding: 'The final email is not the approved one.', suggested_change: 'Use the approved Internal email word for word in the final.' };
  const i2 = {
    id: 'i2',
    finding: 'Internal email, line "**Target:** Friday at 9 a.m. remains the target while the release manager reviews." The line gives no time for the instruction it rests on.',
    suggested_change: 'Tie the line to its evidence, e.g. "Friday at 9 a.m. remains the target, per the release manager\'s 10:15 a.m. note, while they review. It is not a confirmed launch." Keep the email at 80 words or fewer.',
  };
  const final = (email: string) => `# Brief\n\nText.\n\n# Internal Email\n\n${email}\n`;
  const paraphrased = final(EMAIL.replace('remains the target while the release manager reviews.', 'stays the target under the release manager\'s 10:15 a.m. note while they review.'));

  it('the paraphrased fix stays, and the record says which row holds the copy', () => {
    const out = approvedCopiesFor(paraphrased, [copyRow, i2], [source], 'final');
    expect(out.content).toBe(paraphrased);
    expect(out.notes).toEqual(['Internal email v1 not copied over the text: accepted change i2 changes it (i9)']);
  });

  it('with no row about it, the copy is made', () => {
    expect(approvedCopiesFor(paraphrased, [copyRow], [source], 'final').content).toContain('remains the target while the release manager reviews.');
  });

  it('a row that keeps the text as it is does not hold the copy', () => {
    const keeps = { id: 'i3', finding: 'Email line "**Target:** Friday at 9 a.m. remains the target while the release manager reviews." matches the brief.', suggested_change: 'No change needed.' };
    expect(approvedCopiesFor(paraphrased, [copyRow, keeps], [source], 'final').content).toContain('remains the target while the release manager reviews.');
  });
});
