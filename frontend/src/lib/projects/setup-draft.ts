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
import type { DraftBrief, Turn } from '@/components/projects/front-door';
import type { NewFact } from '@/lib/supabase/facts';
import type { DesignedWorkflow } from '@/lib/workflow/custom';
import type { SetupRationale } from '@/types';

export interface FrontDoorState {
  turns: Turn[];
  brief: DraftBrief;
  ready: boolean;
}

export interface DesignerState {
  open: boolean;
  description: string;
  design: DesignedWorkflow | null;
}

export interface SetupDraftState {
  v: 1;
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
  const at = Number.isNaN(when.getTime())
    ? ''
    : ` from ${when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  const what = s.designer?.design
    ? `a workflow being designed (${s.designer.design.stages.length} stages)`
    : s.frontDoor?.turns.length
      ? 'a conversation about what you want to do'
      : s.step === 'setup'
        ? 'a setup ready to start'
        : 'what you were asking';
  const first = (s.draft?.objective || s.objective).trim().split('\n')[0] ?? '';
  return `You have an unfinished setup${at}: ${what}${first ? ` — "${first.length > 80 ? `${first.slice(0, 77)}…` : first}"` : ''}.`;
}
