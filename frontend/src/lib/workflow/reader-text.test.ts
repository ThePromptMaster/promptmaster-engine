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
