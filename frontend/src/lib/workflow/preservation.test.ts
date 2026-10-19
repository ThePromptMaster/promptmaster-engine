/**
 * 14 Oct (Sean, workshop time change): the recheck after "start at 10:00
 * a.m." moved every time and dropped the checklist's "Confirm 12 attendees"
 * and the invitation's greeting and sign-off. The texts are the production
 * versions, v4 (the user's change, applied) and v5 (Go's recheck).
 */
import { describe, expect, it } from 'vitest';

import { asksForRemovals, describeLines, isChangeNote, keepUnasked, removedLines, structureDropped } from './preservation';
import { splitChangeNote } from '@/lib/agent/perform';

const V3 = "## Invitation email\n\nSubject: Workshop invitation — November 20, 2026\n\nHello,\n\nYou are invited to the team workshop on November 20, 2026, from 9:00 a.m. to noon in Room Cedar. There will be 12 attendees, and Maya will facilitate every session.\n\nBest,  \nMaya\n\n## Timed agenda\n\nNovember 20, 2026  \n9:00 a.m. to noon  \nRoom Cedar\n\n- 9:00 a.m. to 9:15 a.m. — Introduction\n- 9:15 a.m. to 10:15 a.m. — Training\n- 10:15 a.m. to 10:30 a.m. — Break\n- 10:30 a.m. to 11:30 a.m. — Group exercise\n- 11:30 a.m. to noon — Closing discussion\n\n## Facilitator checklist\n\nNovember 20, 2026  \n9:00 a.m. to noon  \nRoom Cedar\n\n- Maya facilitates every session.\n- Prepare 12 handouts.\n- Confirm 12 attendees.\n- Be ready for the introduction, training, break, group exercise, and closing discussion.";
const V4 = "## Invitation email\n\nSubject: Workshop invitation — November 20, 2026\n\nHello,\n\nYou are invited to the team workshop on November 20, 2026, from 10:00 a.m. to 1:00 p.m. in Room Cedar. There will be 12 attendees, and Maya will facilitate every session.\n\nBest,  \nMaya\n\n## Timed agenda\n\nNovember 20, 2026  \n10:00 a.m. to 1:00 p.m.  \nRoom Cedar\n\n- 10:00 a.m. to 10:15 a.m. — Introduction\n- 10:15 a.m. to 11:15 a.m. — Training\n- 11:15 a.m. to 11:30 a.m. — Break\n- 11:30 a.m. to 12:30 p.m. — Group exercise\n- 12:30 p.m. to 1:00 p.m. — Closing discussion\n\n## Facilitator checklist\n\nNovember 20, 2026  \n10:00 a.m. to 1:00 p.m.  \nRoom Cedar\n\n- Maya facilitates every session.\n- Prepare 12 handouts.\n- Confirm 12 attendees.\n- Be ready for the introduction, training, break, group exercise, and closing discussion.";
const V5 = "## Invitation email\n\nSubject: Workshop invitation — November 20, 2026\n\nWorkshop invitation for November 20, 2026, from 10:00 a.m. to 1:00 p.m. in Room Cedar. There will be 12 attendees, and Maya will facilitate every session.\n\n## Timed agenda\n\nNovember 20, 2026  \n10:00 a.m. to 1:00 p.m.  \nRoom Cedar\n\n- 10:00 a.m. to 10:15 a.m. — Introduction\n- 10:15 a.m. to 11:15 a.m. — Training\n- 11:15 a.m. to 11:30 a.m. — Break\n- 11:30 a.m. to 12:30 p.m. — Group exercise\n- 12:30 p.m. to 1:00 p.m. — Closing discussion\n\n## Facilitator checklist\n\nNovember 20, 2026  \n10:00 a.m. to 1:00 p.m.  \nRoom Cedar\n\n- Maya facilitates every session.\n- Prepare 12 handouts.\n- Be ready for the introduction, training, break, group exercise, and closing discussion.";
const SPEECH_BEFORE = "Hi everyone. I’m Emma’s older brother, which means I’ve had the longest time to figure out who she is.\n\nWhen we were kids, Emma used to make me rehearse her school presentations with her. And if I skipped a line, she corrected me straight away. No hesitation. We still joke that she was my first boss, and honestly, she was very good at it.\n\nThat story is funny, but it’s also very Emma. She’s always been thoughtful and dependable. She pays attention. She follows through. And if you’re lucky enough to be one of her people, she’s fully in your corner.\n\nOne of the nicest things about Alex is that with him, all of that seems to have an easy place to land. The two of them really listen to each other, they make each other laugh, and they’re completely comfortable being themselves together. Watching them, you get the sense that nothing is forced. They just fit. Not in a showy way — in a real way.\n\nAnd I think that’s what makes everyone so happy to celebrate them today. Emma deserves someone who sees her properly, and Alex clearly does. And Alex, for the record, anyone who can make Emma laugh and also keep up with her is doing very well.\n\nEmma, I’m really happy for you. Alex, I’m really glad you’re part of the family. I love you both, and I hope your life together stays full of laughter, honesty, and that same comfort you already have with each other.\n\nSo please join me in a toast to Emma and Alex.";
const SPEECH_AFTER = "Hi everyone. I’m Emma’s older brother, so I’ve had a pretty long time to know exactly who she is.\n\nWhen we were kids, Emma used to make me rehearse her school presentations with her. And if I skipped a line, she’d stop me straight away and make me do it properly. We still joke that she was my first boss. Honestly, that was probably the beginning of a lifelong pattern of Emma being the organized one and me just trying to keep up.\n\nBut that story really does sum her up. Emma is thoughtful, dependable, and the kind of person who really shows up for people. If she cares about you, you know it. She pays attention, she remembers the important stuff, and she’s someone you can count on.\n\nAnd one of the nicest things about seeing Emma with Alex is just how easy they are together. They really listen to each other, they make each other laugh, and they seem completely comfortable being themselves around each other. Nothing about them feels forced. They just seem really solid, and really happy.\n\nThat’s a lovely thing to witness if you know Emma, because you want that for her. You want her to be with someone who really sees her and appreciates everything that makes her who she is. And it’s very clear Alex does.\n\nAlex, we’re really happy you’re part of the family. Emma, I’m really happy for you.\n\nI love you both, and I hope your life together is full of laughter, honesty, and the same ease you already have with each other.\n\nSo please join me in a toast to Emma and Alex.";

describe('the workshop recheck: what went without being asked', () => {
  it('finds the greeting, the sign-off and the checklist line — not the moved times', () => {
    expect(removedLines(V4, V5).map((r) => r.line.trim())).toEqual(['Hello,', 'Best,', 'Maya', '- Confirm 12 attendees.']);
  });

  it('puts them back where they stood', () => {
    const kept = keepUnasked(V4, V5, 'Output and evaluation was reopened because: Objective and setup was changed (now v2)');
    expect(kept.restored).toEqual(['Hello,', 'Best,', 'Maya', '- Confirm 12 attendees.']);
    expect(kept.text).toContain('Subject: Workshop invitation — November 20, 2026\n\nHello,\n\nWorkshop invitation for November 20');
    expect(kept.text).toContain('Maya will facilitate every session.\n\nBest,  \nMaya\n\n## Timed agenda');
    expect(kept.text).toContain('- Prepare 12 handouts.\n- Confirm 12 attendees.\n- Be ready');
    expect(removedLines(V4, kept.text)).toEqual([]);
  });

  it('the time change itself removed nothing', () => {
    const instruction = 'The workshop now starts at 10:00 a.m. instead of 9:00 a.m. Keep all five activity durations unchanged. Everything else stays the same. Update the workshop documents.';
    expect(asksForRemovals(instruction)).toBe(false);
    expect(removedLines(V3, V4)).toEqual([]);
    expect(keepUnasked(V3, V4, instruction).text).toBe(V4);
  });

  it('a line a fact has replaced is not brought back', () => {
    const kept = keepUnasked(V4, V5, 'recheck', (line) => !/Confirm 12/.test(line));
    expect(kept.restored).not.toContain('- Confirm 12 attendees.');
  });

  it('names what it put back', () => {
    expect(describeLines(['Hello,', 'Best,', 'Maya', '- Confirm 12 attendees.'])).toBe('“Hello,”, “Best,”, “Maya” and “Confirm 12 attendees.”');
  });
});

describe('an instruction that asks for a rewrite or a removal', () => {
  it.each([
    'Make the speech less polished and more like an older brother talking naturally.',
    'Remove the checklist.',
    'Shorten it to one page.',
  ])('%s', (instruction) => {
    expect(asksForRemovals(instruction)).toBe(true);
    expect(keepUnasked(SPEECH_BEFORE, SPEECH_AFTER, instruction).restored).toEqual([]);
  });
});

describe('a line edited in place, or named by the instruction, is not put back (14 Oct, production)', () => {
  const before = '## Timed agenda\n\n- 9:00 a.m.–9:15 a.m. — Introduction\n- Training (0 minutes) — Maya\n- 10:15 a.m.–10:30 a.m. — Break';
  const after = '## Timed agenda\n\n- 9:00 a.m.–9:15 a.m. — Introduction\n- 9:15 a.m.–10:15 a.m. — Training (60 minutes) — Maya facilitates\n- 10:15 a.m.–10:30 a.m. — Break';

  it('an edited line still has all its words in one new line', () => {
    expect(removedLines(before, after)).toEqual([]);
  });

  it('a line the instruction names is the instruction’s to change', () => {
    const replaced = '## Timed agenda\n\n- 9:00 a.m.–9:15 a.m. — Introduction\n- 9:15 a.m.–10:15 a.m. — Session two\n- 10:15 a.m.–10:30 a.m. — Break';
    expect(keepUnasked(before, replaced, 'Fix the timed agenda, including the 0-minute Training item.').restored).toEqual([]);
    // Not named: put back, as before.
    expect(keepUnasked(before, replaced, 'Fix the break.').restored).toEqual(['- Training (0 minutes) — Maya']);
  });
});

describe('a revision note is never put back into the document (18 Oct, pilot)', () => {
  // Output v4 opened with revision notes above "## Status summary"; a review
  // asked for them to go, and the guard put the shortest one back in v5.
  const notes = [
    '- The summary now includes the $6,000 proposed-increase calculation.',
    '- KES-T2 now reads "60% as last reported".',
    '- The tracker’s last column is now "Dependency / dates".',
    '- The log is regrouped under the four required headings. The separate "current" rows are folded into the superseded entries.',
    '',
    'I followed the accepted facts, which name Omar as proposer, and set aside the stray line.',
  ].join('\n');
  const log = '| S-03 | Nov 7 | Spending | $16,000 | Correction | Current | Supersedes S-02 |';
  const body = [
    '## Status summary',
    '',
    '- Build is in progress, 60% as last reported.',
    '- It is now forecast to finish November 12.',
    '- Confirm 12 attendees.',
    '',
    '## Decision and change log',
    '',
    '| Entry | Date | Item | Value | Raised by | Status | Notes |',
    '|---|---|---|---|---|---|---|',
    log,
  ].join('\n');
  const v4 = `${notes}\n\n${body}`;

  it('reads the notes as notes, and the document as the document', () => {
    for (const line of notes.split('\n').filter(Boolean)) expect(isChangeNote(line)).toBe(true);
    for (const line of ['- It is now forecast to finish November 12.', '- Confirm 12 attendees.', log, '## Status summary', '- Build is in progress, 60% as last reported.', '- Elena now says the launch is November 24.', 'The risk register lists three open risks.', '- We added two engineers in Q3.', 'We kept the Friday deadline.'])
      expect(isChangeNote(line)).toBe(false);
  });

  it('the notes the repair removed stay removed', () => {
    const kept = keepUnasked(v4, body, 'Repair the Output after the November 6 approval.');
    expect(kept.restored).toEqual([]);
    expect(kept.reported).toEqual([]);
    expect(kept.text).not.toMatch(/now includes|I followed/);
  });

  it('document lines the repair dropped still come back, the change-log row among them', () => {
    const dropped = body.replace(`${log}`, '').replace('- It is now forecast to finish November 12.\n', '').replace('- Confirm 12 attendees.\n', '');
    const kept = keepUnasked(v4, dropped, 'Repair the Output after the November 6 approval.');
    expect(kept.restored).toEqual(['- It is now forecast to finish November 12.', '- Confirm 12 attendees.', log]);
    expect(kept.text).not.toMatch(/now includes/);
  });

  it('a line in the authors’ own voice is the document, and comes back when dropped', () => {
    const withTeam = body.replace('- Confirm 12 attendees.', '- Confirm 12 attendees.\n- We added two engineers in Q3.');
    const kept = keepUnasked(`${notes}\n\n${withTeam}`, body, 'Repair the Output after the November 6 approval.');
    expect(kept.restored).toEqual(['- We added two engineers in Q3.']);
  });

  it('notes written above the first heading go to the version’s record, not the document', () => {
    expect(splitChangeNote(v4)).toEqual({
      note: expect.stringContaining('The summary now includes the $6,000 proposed-increase calculation.'),
      body,
    });
    expect(splitChangeNote(`What changed: Applied the approval.\n\n${notes}\n\n${body}`).note).toMatch(/^Applied the approval\. The summary now includes/);
    // An opening paragraph that is part of the document stays.
    const intro = `Prepared for the steering group.\n\n${body}`;
    expect(splitChangeNote(intro)).toEqual({ note: null, body: intro });
  });
});

describe('a shortening keeps the structure the brief needs (17 Oct, Sean: FIELDGUIDE)', () => {
  const BEFORE = [
    '# 2. Three-workshop curriculum',
    '## Workshop 1: Structured Interview Foundations',
    '- Opening and objectives (10 minutes)',
    '- Paired practice (25 minutes)',
    '- Debrief (15 min)',
    '## Workshop 2: Live Interview Practice',
    'Practice in pairs.',
    '# 4. Pilot evaluation plan',
    'Proposed measures.',
  ].join('\n');

  it('names a dropped heading and timings that all went', () => {
    const after = ['# 2. Three-workshop curriculum', '## Workshop 1: Structured Interview Foundations', 'Objectives, paired practice and a debrief.', '# 4. Pilot evaluation plan', 'Measures.'].join('\n');
    expect(structureDropped(BEFORE, after)).toEqual(['the timings under "Workshop 1: Structured Interview Foundations"', 'the "Workshop 2: Live Interview Practice" heading']);
  });

  it('is content with shorter text that keeps every heading and some timing, renumbered or not', () => {
    const after = ['# Three-workshop curriculum', '## Workshop 1: Structured Interview Foundations', '- Objectives (10 min); practice (35 min)', '## Workshop 2: Live Interview Practice', 'Pairs.', '# 3. Pilot evaluation plan', 'Measures.'].join('\n');
    expect(structureDropped(BEFORE, after)).toEqual([]);
  });
});

describe('a labelled line a correction reworded (19 Oct, Ridgeway)', () => {
  const BEFORE = [
    '## Calculations',
    '',
    '**[Calculation] Conversion of the quarter-on-quarter growth (C6).**',
    'Revenue rose from $28 million to $30 million.',
    '',
    'Prepared for the board.',
  ].join('\n');
  const AFTER = [
    '## Calculations',
    '',
    '[Calculation] Quarter-on-quarter decline (C6).',
    'Revenue fell from $28 million to $27 million.',
  ].join('\n');
  const INSTRUCTION = 'The CFO corrects the current-quarter results: revenue was $27 million, not $30 million.';

  it('is the same line reworded, not a line dropped, so the stale growth line is not put back', () => {
    const kept = keepUnasked(BEFORE, AFTER, INSTRUCTION);
    expect(kept.restored).not.toContain('**[Calculation] Conversion of the quarter-on-quarter growth (C6).**');
    expect(kept.text).not.toMatch(/quarter-on-quarter growth/);
  });

  it('still puts back an unrelated line the revision dropped', () => {
    expect(keepUnasked(BEFORE, AFTER, INSTRUCTION).restored).toEqual(['Prepared for the board.']);
  });

  it('keeps a labelled line whose label no new line carries', () => {
    const after = AFTER.replace(' (C6)', '') + '\n\nPrepared for the board.';
    expect(removedLines(BEFORE, after).map((r) => r.line.trim())).toContain(
      '**[Calculation] Conversion of the quarter-on-quarter growth (C6).**'
    );
  });
});

describe('values an instruction corrects', () => {
  it('are read from "not X" and "instead of X", decimals included', async () => {
    const { correctedValues } = await import('./preservation');
    const v = correctedValues('Revenue was $27 million, not $30 million, and EBITDA was $3.6 million, not $4.2 million. Use 75 hours instead of 100 hours. Keep it not more than 400 words.');
    expect(v.map((m) => `${m.kind}:${m.value}`)).toEqual(['money:30', 'money:4.2', 'numbers:100']);
  });

  it('are never put back when the revision dropped the line stating them', () => {
    const before = 'Revenue: $30 million.\nPrepared for the board.';
    const after = 'Current-quarter revenue is now reported at $27 million after the CFO correction.';
    const kept = keepUnasked(before, after, 'Revenue was $27 million, not $30 million.');
    expect(kept.restored).toEqual(['Prepared for the board.']);
  });
});
