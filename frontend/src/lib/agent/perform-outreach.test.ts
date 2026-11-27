import { beforeEach, describe, expect, it, vi } from 'vitest';

const events = vi.fn();
vi.mock('@/lib/supabase/workflow', () => ({ appendWorkflowEvent: (...a: unknown[]) => events(...a) }));
vi.mock('@/lib/supabase/outreach-identity', () => ({ listSenders: async () => [], listSignatures: async () => [] }));
vi.mock('@/lib/api/client', () => ({ api: {} }));

import { initialState } from '@/lib/workflow/engine';
import { EMAIL_OUTREACH_V1 } from '@/lib/workflow/templates/email-outreach.v1';
import { blankContact, serializeContacts } from '@/lib/outreach/contacts';
import { blankMessage, serializeDrafts, serializeMessage, syncDrafts } from '@/lib/outreach/drafts';
import { recheckOutreach } from './perform-outreach';
import type { PerformContext } from './perform';

const template = EMAIL_OUTREACH_V1;
const stage = (part: string) => template.stages.find((s) => s.outreach?.part === part)!;
const v = (id: string, content: string, at: string, op = 'outreach_edit') => ({ id, version_number: 1, content, created_at: at, source_operation: op });
const contacts = [{ ...blankContact('c1'), name: 'Ann Lee', company: 'Acme', email: 'ann@acme.example', status: 'ready' as const, personal_line: 'Nice hub.' }];
const message = { ...blankMessage(), subject: 'Hello', body: 'Hi {{first_name}}. {{personal_line}}' };
let n = 0;
const drafts = serializeDrafts(syncDrafts(contacts, message, [], () => `d${n++}`));

function ctxFor(target: string, stale: 'in_progress' | 'complete', contactsChanged = true) {
  const state = initialState(template);
  const append = vi.fn().mockResolvedValue({ id: 'new-version' });
  const bundles = {
    [stage('contacts').id]: { versions: [v('c-old', serializeContacts({ kind: 'stage_items', imports: [], items: [] }), '2026-11-27T00:00:00Z'), ...(contactsChanged ? [v('c-new', serializeContacts({ kind: 'stage_items', imports: [], items: contacts }), '2026-11-27T02:00:00Z')] : [])] },
    [stage('message').id]: { versions: [v('m1', serializeMessage(message), '2026-11-27T01:00:00Z', 'outreach_message')] },
    [stage('drafts').id]: { versions: [v('d1', drafts, '2026-11-27T01:30:00Z', 'outreach_drafts')] },
  };
  const ctx = {
    project: { id: 'p1', user_id: 'u1', model: 'm', web_access: 'on' },
    template,
    state: { ...state, stages: { ...state.stages, [target]: { ...state.stages[target], status: 'stale', stale: { reason: 'Contacts changed.', since: '2026-11-27T02:00:00Z', was: stale } } } },
    stage: stage('drafts'),
    bundles,
    run: { id: 'run1', policy: 'autonomous' },
    approvedByUser: false,
    appendStageVersion: append,
    afterStageEvent: vi.fn(),
    signal: new AbortController().signal,
  } as unknown as PerformContext;
  return { ctx, append };
}

beforeEach(() => events.mockReset().mockResolvedValue(undefined));

// 27 Nov pass: a change to Contacts reopened Message and Drafts, and Go stopped twice.
describe('Go settles a reopened outreach stage', () => {
  it('keeps the message when only the list changed, as a completion Go may record', async () => {
    const { ctx, append } = ctxFor(stage('message').id, 'complete');
    const r = await recheckOutreach(ctx, stage('message'), async () => null);
    expect(r.status).toBe('succeeded');
    expect(append).not.toHaveBeenCalled();
    expect(events.mock.calls[0][2]).toMatchObject({ type: 'stage_marked_complete', stage_id: stage('message').id, payload: { evidence_version_id: 'm1', checked_unchanged: true } });
  });

  it('answers reopened emails already in line with a version recording the check, never a reopen event', async () => {
    const { ctx, append } = ctxFor(stage('drafts').id, 'in_progress');
    const r = await recheckOutreach(ctx, stage('drafts'), async () => null);
    expect(r).toMatchObject({ status: 'succeeded', versionIds: ['new-version'] });
    expect(append.mock.calls[0][2]).toMatchObject({ content: drafts, source_operation: 'outreach_drafts' });
    expect(events).not.toHaveBeenCalled();
  });

  it('leaves a round the user signed off to the user', async () => {
    const { ctx, append } = ctxFor(stage('drafts').id, 'complete');
    const r = await recheckOutreach(ctx, stage('drafts'), async () => null);
    expect(r.status).toBe('failed');
    expect(append).not.toHaveBeenCalled();
  });
});
