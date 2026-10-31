/**
 * An unfinished setup, as it is kept between visits (U2, 8 Oct).
 *
 * Sean, 7 Oct: "I signed out during setup, and when I returned, the setup
 * wasn't retained … If they aren't saved until a particular step, it would
 * help to make that clear." Everything on /projects/new lived in React state
 * until Start. Now it is written as the user works (`setup_drafts`) and
 * offered back when they return. Pure: the page and the store do the I/O.
 */
import type { SetupDraft } from '@/components/projects/setup-card';
import type { FrontDoorState } from '@/components/projects/front-door';
import type { NewFact } from '@/lib/supabase/facts';
import type { DesignedWorkflow } from '@/lib/workflow/custom';
import type { SetupRationale } from '@/types';
import { getLocale, tr } from '@/lib/i18n/store';

export type { FrontDoorState } from '@/components/projects/front-door';

export interface DesignerState {
  open: boolean;
  description: string;
  design: DesignedWorkflow | null;
}

export interface SetupDraftState {
  v: 1;
  /** 'questions' only in drafts kept before 31 Oct; restored as the conversation. */
  step: 'ask' | 'questions' | 'talk' | 'setup';
  objective: string;
  draft?: SetupDraft;
  templateId?: string | null;
  recommendedKey?: string | null;
  workflowReason?: string;
  rationale?: SetupRationale | null;
  initialFacts?: NewFact[];
  frontDoor?: FrontDoorState | null;
  designer?: DesignerState | null;
  /** Names of files attached before Start; the files themselves are not kept. */
  attachedNames?: string[];
}

/** Whether there is anything to come back to. */
export function worthKeeping(s: SetupDraftState | null | undefined): boolean {
  if (!s) return false;
  return Boolean(
    s.objective.trim() ||
      s.draft?.objective.trim() ||
      s.frontDoor?.turns.length ||
      s.designer?.design ||
      s.designer?.description.trim()
  );
}

/** "your setup from 7 Oct, 23:40" — what the return banner names. */
export function describeDraft(s: SetupDraftState, updatedAt: string): string {
  const when = new Date(updatedAt);
  // In the interface language (client, 21 Oct); English keeps its day-month order.
  const locale = getLocale();
  const dates = locale === 'en' ? 'en-GB' : locale;
  const at = Number.isNaN(when.getTime())
    ? ''
    : tr('draft.from', {
        date: when.toLocaleDateString(dates, { day: 'numeric', month: 'short' }),
        time: when.toLocaleTimeString(dates, { hour: '2-digit', minute: '2-digit' }),
      });
  const what = s.designer?.design
    ? tr('draft.whatDesigner', { count: s.designer.design.stages.length })
    : s.frontDoor?.turns.length
      ? tr('draft.whatConversation')
      : s.step === 'setup'
        ? tr('draft.whatSetup')
        : tr('draft.whatAsking');
  const first = (s.draft?.objective || s.objective).trim().split('\n')[0] ?? '';
  return tr('draft.unfinished', { at, what, first: first ? ` — "${first.length > 80 ? `${first.slice(0, 77)}…` : first}"` : '' });
}
