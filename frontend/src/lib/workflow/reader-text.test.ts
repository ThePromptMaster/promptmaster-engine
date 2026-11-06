import { describe, expect, it } from 'vitest';
import { forReader, internalMentions } from './reader-text';

/** 28 Oct (Sean, HarborDesk): internal version and review terms in the final documents. */

describe('forReader', () => {
  it('drops stamps, revision narration and a "what changed" section', () => {
    const text = [
      '# Support playbook',
      'Agents answer chats from 8 a.m. to 8 p.m.',
      'I removed the refund promise as requested.',
      '## What changed in this version',
      '- Hours corrected.',
      '## Escalation',
      'Escalate after two failed replies.',
      '_[PromptMaster draft v3 1a2b3c4d]_',
    ].join('\n');
    expect(forReader(text)).toBe(
      '# Support playbook\nAgents answer chats from 8 a.m. to 8 p.m.\n## Escalation\nEscalate after two failed replies.'
    );
  });

  it('keeps a change log the user asked for', () => {
    const text = '# Pack\n## What changed in this version\n- Hours corrected.';
    expect(forReader(text, true)).toBe(text);
  });
});

describe('internalMentions', () => {
  it('names process talk once each, as written', () => {
    expect(internalMentions('Unlike the previous draft, v3 adds hours. See v3. PromptMaster wrote this.')).toEqual([
      'the previous draft',
      'v3',
      'PromptMaster',
    ]);
  });

  it('leaves software versions, tables and code alone, and says nothing when a change log was asked for', () => {
    expect(internalMentions('Requires Python 3.12 and version 2 of the API.\n| v2 | ok |\n```\nv3\n```')).toEqual([]);
    expect(internalMentions('The previous draft said otherwise.', true)).toEqual([]);
  });
});

describe('a review note the user asked for stays in what they get (5 Nov, a book test)', () => {
  const book = '## Chapter 1\n\nText.\n\n## Review Note: Manuscript Checked Against the Outline\n\nChapter 4 holds.\n';

  it('is taken out as process talk when nobody asked for it', () => {
    expect(forReader(book)).not.toContain('Chapter 4 holds.');
  });

  it('stays when it was asked for, and other notes about the revision still go', () => {
    const kept = forReader(`${book}\n## What changed in this version\n\nI removed a line.\n`, false, true);
    expect(kept).toContain('## Review Note');
    expect(kept).toContain('Chapter 4 holds.');
    expect(kept).not.toContain('I removed a line.');
  });
});
