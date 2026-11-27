/**
 * Go on an Outreach workflow (Sean, 26 Nov): it fills in the blanks on the contact list, writes the
 * standard message, and makes an email per ready contact. It never approves or sends: those are the
 * user's presses on the Drafts stage, and nothing here imports the approval or sending code
 * (`outreach-no-send.test.ts`).
 *
 * The page and Go fill in the blanks through the same runner (`lib/outreach/research-run.ts`), one
 * at a time per Contacts stage (`assess-lock`, keyed by the stage).
 */
import { api } from '@/lib/api/client';
import { parseContacts } from '@/lib/outreach/contacts';
import { parseDrafts, parseMessage, serializeDrafts, serializeMessage, syncDrafts } from '@/lib/outreach/drafts';
import { briefText, outreachStages, withWrittenMessage } from '@/lib/outreach/go-work';
import { runResearch, type ResearchResponse } from '@/lib/outreach/research-run';
import { listSenders, listSignatures } from '@/lib/supabase/outreach-identity';
import { assessKey, claimAssess, releaseAssess, reportAssess, whenAssessFree } from '@/lib/workflow/assess-lock';
import { modeForStage } from '@/lib/workflow/stage-mode';
import { inputsFrom } from '@/lib/workflow/stage-requests';
import { webAccessOf, type WebUse } from '@/lib/workflow/web-found';
import { appendWorkflowEvent } from '@/lib/supabase/workflow';
import type { StageDefinition } from '@/lib/workflow/types';
import type { PerformContext } from './perform';
import { stageMoveActor } from './policy';
import { upstreamChanges } from './recheck-first';

export type OutreachActionKey = 'research_contacts' | 'draft_outreach';

export interface OutreachOutcome {
  status: 'succeeded' | 'failed';
  output: string;
  toolsUsed: ('model' | 'web')[];
  versionIds: string[];
}

const BRIEF_MAX = 20_000;
let idCounter = 0;
const newDraftId = () => `d_${Date.now().toString(36)}${(idCounter++).toString(36)}g`;

export async function performOutreach(key: OutreachActionKey, ctx: PerformContext, keep: (res: WebUse) => Promise<unknown>): Promise<OutreachOutcome> {
  if (!ctx.appendStageVersion) throw new Error('This view cannot save versions.');
  const part = ctx.stage.renderer === 'outreach' ? ctx.stage.outreach?.part : undefined;
  const versionIds: string[] = [];
  let head = ctx.bundles[ctx.stage.id]?.versions.at(-1)?.content ?? '';
  const save = async (content: string, operation: string, summary: string, model?: string) => {
    if (content === head) return;
    const created = await ctx.appendStageVersion!(ctx.stage.id, ctx.stage.label, {
      content,
      source_operation: operation,
      base_content: head,
      model: model ?? ctx.project.model,
      mode: modeForStage(ctx.project, ctx.stage),
      change_summary: `Go mode: ${summary}`,
    });
    head = content;
    const id = (created as { id?: unknown } | null)?.id;
    if (typeof id === 'string') versionIds.push(id);
  };
  const brief = briefText(ctx.template, ctx.bundles).slice(0, BRIEF_MAX);

  if (key === 'research_contacts') {
    if (part !== 'contacts') return { status: 'failed', output: 'Filling in the blanks happens on the contact list.', toolsUsed: [], versionIds };
    if (webAccessOf(ctx.project) !== 'on') {
      return { status: 'failed', output: 'Filling in the blanks searches the web, and Web access is off for this project.', toolsUsed: [], versionIds };
    }
    const lockKey = assessKey(ctx.project.id, ctx.stage.id);
    if (!claimAssess(lockKey, 'go')) {
      await whenAssessFree(lockKey, ctx.signal);
      return { status: 'succeeded', output: 'You were filling in the blanks on the page, so Go waited for it rather than search the same rows.', toolsUsed: [], versionIds };
    }
    try {
      let model: string | undefined;
      const run = await runResearch({
        content: head,
        call: async (rows) => {
          const res = await api.researchContacts({ inputs: inputsFrom(ctx.project), brief, rows, web_access: 'on' }, ctx.signal);
          model = res.model_used || model;
          return res;
        },
        keep: (res: ResearchResponse) => keep(res),
        save: (content, summary) => save(content, 'outreach_research', summary, model),
        signal: ctx.signal,
        onProgress: (done, total) => reportAssess(lockKey, 'go', done, total - done),
      });
      if (run.error) return { status: 'failed', output: `Filling in the blanks stopped: ${run.error}`, toolsUsed: ['model', 'web'], versionIds };
      const waiting = parseContacts(head).items.filter((r) => r.status === 'decide').length;
      return {
        status: 'succeeded',
        toolsUsed: ['model', 'web'],
        versionIds,
        output:
          `Searched the web for ${run.researched} contact${run.researched === 1 ? '' : 's'} and filled in ${run.filled}. ` +
          'Each value shows the page it came from.' +
          (waiting ? ` ${waiting} wait${waiting === 1 ? 's' : ''} on you under "Needs you" on the list.` : ''),
      };
    } finally {
      releaseAssess(lockKey, 'go');
    }
  }

  const { parts } = outreachStages(ctx.template);
  const latest = (stageId: string | undefined) => (stageId ? ctx.bundles[stageId]?.versions.at(-1)?.content ?? null : null);

  if (part === 'message') {
    const res = await api.draftOutreachMessage({ inputs: inputsFrom(ctx.project), brief, model: ctx.project.model, web_access: webAccessOf(ctx.project) });
    await keep(res);
    const [senders, signatures] = await Promise.all([listSenders().catch(() => []), listSignatures().catch(() => [])]);
    const sender = senders[0] ?? null;
    const mine = signatures.filter((s) => s.sender_id === sender?.id);
    const message = withWrittenMessage(parseMessage(head), res, {
      sender_id: sender?.id ?? null,
      signature_id: mine.find((s) => s.kind === 'first')?.id ?? null,
      reply_signature_id: mine.find((s) => s.kind === 'reply')?.id ?? null,
    });
    await save(serializeMessage(message), 'outreach_message', 'wrote the standard message and its follow-up from the brief.', res.model_used);
    return {
      status: 'succeeded',
      toolsUsed: res.web_query ? ['model', 'web'] : ['model'],
      versionIds,
      output: `Wrote the standard message ("${message.subject}") and a follow-up from the brief. Each contact's email is made from it; edit it here and every email that was not edited by hand follows.`,
    };
  }

  if (part === 'drafts') {
    const message = parseMessage(latest(parts.message?.id));
    if (!message || (!message.subject.trim() && !message.body.trim())) return { status: 'failed', output: 'There is no standard message to make the emails from yet.', toolsUsed: [], versionIds };
    const contacts = parseContacts(latest(parts.contacts?.id)).items;
    const drafts = parseDrafts(head);
    const synced = syncDrafts(contacts, message, drafts, newDraftId);
    await save(serializeDrafts(synced), 'outreach_drafts', `made the emails from the message for ${synced.length} contact${synced.length === 1 ? '' : 's'}.`);
    return {
      status: 'succeeded',
      toolsUsed: [],
      versionIds,
      output: `Made ${synced.length} email${synced.length === 1 ? '' : 's'} from the message, one per ready contact; your own edits are kept. Approving and sending are yours, on this stage.`,
    };
  }
  return { status: 'failed', output: 'This stage is not part of an outreach workflow.', toolsUsed: [], versionIds };
}


/**
 * A reopened outreach stage (27 Nov, production pass: a change to Contacts reopened Message and
 * Drafts, and Go stopped with "a repair failed"). Each part is settled in code, with no model call:
 * - Contacts: the list is its own rows; it is kept and marked complete again.
 * - Message: kept when only the list changed. When the brief changed, Go writes it again only if
 *   the current one is Go's own; a message the user edited is theirs to keep or rewrite.
 * - Drafts: brought in line with the contacts and the message (hand edits kept), and back in
 *   progress: approving and sending stay the user's.
 */
export async function recheckOutreach(ctx: PerformContext, target: StageDefinition, keep: (res: WebUse) => Promise<unknown>): Promise<OutreachOutcome> {
  const part = target.outreach?.part;
  const head = ctx.bundles[target.id]?.versions.at(-1);
  const actor = stageMoveActor(ctx.run.policy, ctx.approvedByUser);
  const event = async (type: 'stage_marked_complete', reason: string, payload: Record<string, unknown> = {}) => {
    await appendWorkflowEvent(ctx.project.id, ctx.project.user_id, {
      type,
      stage_id: target.id,
      actor,
      agent_run_id: actor === 'system' ? ctx.run.id : null,
      reason,
      payload: { ...(head ? { evidence_version_id: head.id } : {}), ...payload },
    });
    await ctx.afterStageEvent();
  };
  if (part === 'contacts') {
    await event('stage_marked_complete', 'Checked after a change: the list keeps its own rows, and nothing in them relied on what changed.', { checked_unchanged: true });
    return { status: 'succeeded', toolsUsed: [], versionIds: [], output: `${target.label} keeps its rows as they are; marked complete again.` };
  }
  if (part === 'message') {
    const changes = head ? upstreamChanges(ctx.template, ctx.bundles, target.id, head.created_at) ?? [] : [];
    const onlyTheList = changes.every((c) => ctx.template.stages.find((s) => s.id === c.stageId)?.renderer === 'outreach');
    if (head?.content?.trim() && onlyTheList) {
      await event('stage_marked_complete', `Checked after a change: ${changes.map((c) => c.label).join(' and ') || 'the list'} changed, and the standard message does not depend on the rows.`, { checked_unchanged: true });
      return { status: 'succeeded', toolsUsed: [], versionIds: [], output: `The standard message does not depend on the contact rows, so it was kept as it is and marked complete again.` };
    }
    if (head && head.source_operation !== 'outreach_message') {
      return { status: 'failed', toolsUsed: [], versionIds: [], output: 'The brief changed after you edited the standard message. Keep it as it is, or write it again on the Message stage.' };
    }
    const written = await performOutreach('draft_outreach', { ...ctx, stage: target }, keep);
    if (written.status === 'succeeded') await event('stage_marked_complete', 'Written again from the changed brief.');
    return written;
  }
  if (part === 'drafts') {
    // A draft in progress that was reopened is answered by its next version (engine:
    // `stage_version_saved`); Go may record a version, not reopen a stage (27 Nov pass: "a
    // autonomous run may not record stage_reopened on its own"). A round the user already signed
    // off is theirs to look at again.
    if (ctx.state.stages[target.id]?.stale?.was !== 'in_progress') {
      return { status: 'failed', toolsUsed: [], versionIds: [], output: `${target.label} was signed off before the change. Look at the emails again and approve the round yourself.` };
    }
    const made = await performOutreach('draft_outreach', { ...ctx, stage: target }, keep);
    if (made.status !== 'succeeded' || made.versionIds.length || !head?.content) return made;
    // Already in line: the check itself is the version that answers the change.
    const created = await ctx.appendStageVersion!(target.id, target.label, {
      content: head.content,
      source_operation: 'outreach_drafts',
      base_content: head.content,
      model: ctx.project.model,
      mode: modeForStage(ctx.project, target),
      change_summary: 'Go mode: checked after the change; the emails already match the contacts and the message.',
    });
    const id = (created as { id?: unknown } | null)?.id;
    return { status: 'succeeded', toolsUsed: [], versionIds: typeof id === 'string' ? [id] : [], output: 'Checked the emails after the change: they already match the contacts and the message. Approving them is yours.' };
  }
  return { status: 'failed', toolsUsed: [], versionIds: [], output: 'This stage is not part of an outreach workflow.' };
}
