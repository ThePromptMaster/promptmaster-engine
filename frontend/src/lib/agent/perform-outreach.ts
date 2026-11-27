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
import type { PerformContext } from './perform';

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
