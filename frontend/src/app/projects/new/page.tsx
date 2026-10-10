'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { GuideInterview } from '@/components/projects/guide-interview';
import { SetupCard, type SetupDraft } from '@/components/projects/setup-card';
import { CustomWorkflowDesigner } from '@/components/projects/custom-workflow-designer';
import { FrontDoor, type DraftBrief } from '@/components/projects/front-door';
import { recordFacts, type NewFact } from '@/lib/supabase/facts';
import { designFromTemplate } from '@/lib/workflow/custom';
import { AutoGrowTextarea } from '@/components/shared/auto-grow-textarea';
import { api } from '@/lib/api/client';
import { createProject, hardDeleteProject } from '@/lib/supabase/projects';
import { appendWorkflowEvent, listTemplates } from '@/lib/supabase/workflow';
import { createArtifact } from '@/lib/supabase/versions';
import type { WorkflowTemplate } from '@/lib/workflow/types';
import type { SetupRationale } from '@/types';
import { splitAsk } from '@/lib/projects/split-ask';
import { StartAttachments, type StartImage } from '@/components/projects/start-attachments';
import { documentsOf, materialFrom, type PreparedFile } from '@/lib/data/attachments';
import { contextFromDocuments } from '@/lib/data/extract-text';
import { imagePreview } from '@/lib/data/preview';
import { INPUT_LIMITS } from '@/lib/projects/input-limits';
import { goalFromSearch } from '@/lib/projects/example-goals';
import { attachProjectFile } from '@/lib/supabase/project-files';
import { LimitCounter } from '@/components/shared/limit-counter';
import { clearSetupDraft, loadSetupDraft, saveSetupDraft } from '@/lib/supabase/setup-drafts';
import { describeDraft, worthKeeping, type DesignerState, type FrontDoorState, type SetupDraftState } from '@/lib/projects/setup-draft';

/**
 * PM-09 — the unified entry.
 *
 * The old page opened on "What are you making? Book / Research / Single
 * output", which asked the user to know the right workflow before they had
 * said what they wanted. Sean wanted the original PromptMaster opening back:
 * "What do you want to do or figure out?", with two ways in — "I know what I
 * want to do" and "Guide me / ask me questions" — and PromptMaster
 * recommending the workflow and mode from the objective.
 *
 *   ask ──I know──────────────────────────▶ setup ──Start──▶ project
 *    └──Guide me──▶ questions ──Recommend──▶ setup
 *
 * Choosing the workflow yourself is still one click away on the first screen.
 */

type Step = 'ask' | 'questions' | 'talk' | 'setup';

/** The output format a Book gets when setup suggested none. */
export const BOOK_OUTPUT_FORMAT = 'A book manuscript in continuous prose, chapter by chapter';

function titleFrom(objective: string): string {
  const firstLine = objective.trim().split('\n')[0] ?? '';
  return firstLine.length <= 60 ? firstLine : `${firstLine.slice(0, 57).trimEnd()}…`;
}

export default function NewProjectPage() {
  // Not gated on the session check: that is a network round trip, and the page
  // used to be blank for it — on production long enough to type into nothing
  // (4 Oct). Start stays disabled until the user is known.
  const { user } = useAuth();
  const router = useRouter();

  const [templates, setTemplates] = useState<(WorkflowTemplate & { id: string })[]>([]);
  const [step, setStep] = useState<Step>('ask');
  const [objective, setObjective] = useState('');
  const [templateId, setTemplateId] = useState<string | null>(null);
  /**
   * Facts and requirements the user gave in the front-door conversation and
   * confirmed: recorded as the project's accepted facts when it is created.
   */
  const [initialFacts, setInitialFacts] = useState<NewFact[]>([]);
  /** A saved workflow being edited as a copy. */
  const [copying, setCopying] = useState<(WorkflowTemplate & { id: string }) | null>(null);
  const [recommendedKey, setRecommendedKey] = useState<string | null>(null);
  const [workflowReason, setWorkflowReason] = useState('');
  const [rationale, setRationale] = useState<SetupRationale | null>(null);
  const [draft, setDraft] = useState<SetupDraft>({
    title: '',
    objective: '',
    audience: 'General',
    constraints: '',
    output_format: '',
    context: '',
    mode: 'architect',
  });
  // Held until Start: a project's files are stored under its id (5 Oct, email 8).
  const [startFiles, setStartFiles] = useState<PreparedFile[]>([]);
  const [startImages, setStartImages] = useState<StartImage[]>([]);
  const material = materialFrom(startFiles, INPUT_LIMITS.context);
  /** The ask split into objective and context, with any attached documents' words after it. */
  const withDocuments = (text: string) => {
    const ask = splitAsk(text);
    return { ...ask, context: contextFromDocuments(ask.context, documentsOf(startFiles), INPUT_LIMITS.context).context };
  };
  const [working, setWorking] = useState<null | 'questions' | 'setup' | 'creating'>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdWithFailures, setCreatedWithFailures] = useState<{ id: string; failed: string[] } | null>(null);
  // Kept apart from `error`: every other action clears that, and a failed
  // workflow list then left "Start" disabled with nothing saying why (4 Oct).
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // U2 (Sean, 7 Oct, email 14): the setup is kept as the user works, and
  // offered back when they return — signing out no longer loses it.
  const [frontDoorState, setFrontDoorState] = useState<FrontDoorState | null>(null);
  const [designerState, setDesignerState] = useState<DesignerState | null>(null);
  /** Remounts the front door and designer with what was restored. */
  const [restoredAt, setRestoredAt] = useState(0);
  const [kept, setKept] = useState<{ data: SetupDraftState; updated_at: string } | null>(null);
  const [draftSaved, setDraftSaved] = useState<'saved' | 'saving' | 'failed' | null>(null);
  const draftChecked = useRef(false);

  const loadTemplates = useCallback(() => {
    setLoadingTemplates(true);
    setTemplatesError(null);
    listTemplates()
      .then(setTemplates)
      .catch((e) => setTemplatesError(e instanceof Error && e.message ? e.message : 'Could not load workflows.'))
      .finally(() => setLoadingTemplates(false));
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // An example goal from the empty project list arrives in the URL; it fills the
  // box and nothing more — the user still chooses how to start.
  useEffect(() => {
    const goal = goalFromSearch(window.location.search, INPUT_LIMITS.objective);
    if (goal) setObjective((current) => current || goal);
  }, []);

  // An unfinished setup from an earlier visit: offered, never applied unasked.
  useEffect(() => {
    if (!user || draftChecked.current) return;
    draftChecked.current = true;
    loadSetupDraft(user.id)
      .then((found) => {
        if (found && worthKeeping(found.data)) setKept(found);
      })
      .catch(() => undefined);
  }, [user]);

  const snapshot: SetupDraftState = {
    v: 1, step, objective, draft, templateId, recommendedKey, workflowReason, rationale, initialFacts,
    frontDoor: frontDoorState, designer: designerState,
    attachedNames: [...startFiles.map((f) => f.file.name), ...startImages.map((i) => i.file.name)],
  };
  const snapshotKey = JSON.stringify(snapshot);
  useEffect(() => {
    // Not while an earlier setup is still on offer: saving now would replace it.
    if (!user || kept || !draftChecked.current || working === 'creating') return;
    const state = JSON.parse(snapshotKey) as SetupDraftState;
    if (!worthKeeping(state)) return;
    setDraftSaved('saving');
    const timer = setTimeout(() => {
      saveSetupDraft(user.id, state)
        .then(() => setDraftSaved('saved'))
        .catch(() => setDraftSaved('failed'));
    }, 800);
    return () => clearTimeout(timer);
  }, [snapshotKey, user, kept, working]);

  function restoreKept() {
    if (!kept) return;
    const k = kept.data;
    setStep(k.step);
    setObjective(k.objective);
    if (k.draft) setDraft(k.draft);
    setTemplateId(k.templateId ?? null);
    setRecommendedKey(k.recommendedKey ?? null);
    setWorkflowReason(k.workflowReason ?? '');
    setRationale(k.rationale ?? null);
    setInitialFacts(k.initialFacts ?? []);
    setFrontDoorState(k.frontDoor ?? null);
    setDesignerState(k.designer ?? null);
    setRestoredAt(Date.now());
    setKept(null);
  }

  function discardKept() {
    if (user) void clearSetupDraft(user.id).catch(() => undefined);
    setKept(null);
  }

  const templateFor = (key: string) => templates.find((t) => t.key === key) ?? null;
  const selected = templates.find((t) => t.id === templateId) ?? null;

  // The list arrived after the setup was recommended (a retry): select what
  // was recommended, so the user is not left to find it again.
  const [prevTemplates, setPrevTemplates] = useState(templates);
  if (prevTemplates !== templates) {
    setPrevTemplates(templates);
    if (step === 'setup' && !templateId && templates.length) {
      setTemplateId((templates.find((t) => t.key === (recommendedKey ?? 'book')) ?? templates[0]).id);
    }
  }
  const hasObjective = objective.trim().length > 0;

  async function recommend(given?: { question: string; answer: string }[], from?: { objective: string; material: string }) {
    setWorking('setup');
    setError(null);
    const ask = from?.objective ?? objective;
    const brought = [material, from?.material ?? ''].filter(Boolean).join('\n\n');
    try {
      const { suggestion } = await api.generateSetup({
        objective: ask.trim(),
        answers: given?.length ? given.slice(0, 8) : undefined,
        ...(brought ? { material: brought } : {}),
      });
      const recommended = templateFor(suggestion.workflow) ?? templateFor('single_output');
      setTemplateId(recommended?.id ?? null);
      setRecommendedKey(suggestion.workflow);
      setWorkflowReason(suggestion.workflow_reason);
      setRationale(suggestion.rationale);
      const split = withDocuments(ask);
      setDraft({
        title: titleFrom(ask),
        objective: split.objective,
        context: split.context,
        audience: suggestion.audience || 'General',
        constraints: suggestion.constraints,
        output_format: suggestion.output_format,
        mode: suggestion.mode,
      });
      setStep('setup');
    } catch (e) {
      setError(
        `Could not recommend a setup${e instanceof Error && e.message ? `: ${e.message}` : ''}. You can choose the workflow yourself.`
      );
    } finally {
      setWorking(null);
    }
  }

  /** The front door confirmed: its brief becomes the setup, and its facts the initial record. */
  function fromConversation(brief: DraftBrief, transcript: string) {
    setObjective(brief.objective);
    // A point the brief lists as a requirement is not recorded again as a fact.
    const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9$%]+/g, ' ').trim();
    const required = new Set(brief.requirements.map(norm));
    setInitialFacts([
      ...brief.requirements.map((statement) => ({ statement, kind: 'requirement' as const, source_kind: 'chat' as const, source_ref: { via: 'front door' } })),
      ...brief.evidence
        .filter((statement) => !required.has(norm(statement)))
        .map((statement) => ({ statement, kind: 'fact' as const, source_kind: 'chat' as const, source_ref: { via: 'front door' } })),
    ]);
    const lines = [
      brief.audience && `Audience: ${brief.audience}`,
      brief.deliverables.length && `Deliverables: ${brief.deliverables.join('; ')}`,
      brief.stages.length && `Stages discussed: ${brief.stages.join(' › ')}`,
      brief.approvals.length && `Approvals wanted: ${brief.approvals.join('; ')}`,
    ].filter(Boolean);
    void recommend(undefined, { objective: brief.objective, material: [lines.join('\n'), `The conversation:\n${transcript}`].filter(Boolean).join('\n\n') });
  }

  // The questions are asked one at a time, on their own screen (1 Oct, item 9).
  function guideMe() {
    setError(null);
    setStep('questions');
  }

  function chooseYourself() {
    setTemplateId(templateFor('book')?.id ?? templates[0]?.id ?? null);
    setRecommendedKey(null);
    setWorkflowReason('');
    setRationale(null);
    setDraft((d) => ({ ...d, title: titleFrom(objective), ...withDocuments(objective) }));
    setStep('setup');
  }

  async function handleCreate() {
    if (!user || !selected || working || createdWithFailures) return;
    setWorking('creating');
    setError(null);
    let createdId: string | null = null;
    try {
      const project = await createProject(
        {
          title: draft.title.trim() || titleFrom(draft.objective) || 'Untitled project',
          objective: draft.objective.trim(),
          audience: draft.audience.trim() || 'General',
          constraints: draft.constraints.trim(),
          context: draft.context.trim(),
          // A book's deliverable is prose. Left empty, every chapter prompt
          // read "Output format: (none)" and the mode's structural habits
          // filled the gap (2 Oct: "it really wants to make outlines").
          output_format: draft.output_format.trim() || (selected.key === 'book' ? BOOK_OUTPUT_FORMAT : ''),
          mode: draft.mode,
          workflow: selected.key,
        },
        user.id
      );
      createdId = project.id;

      // Pin the exact template version, so a later revision cannot reshape a
      // project that is already under way.
      const { createClient } = await import('@/lib/supabase/client');
      const { error: pinError } = await createClient()
        .from('projects')
        .update({
          workflow_template_id: selected.id,
          stage: selected.stages[0]?.id ?? '',
        })
        .eq('id', project.id);
      if (pinError) throw pinError;

      await createArtifact(project.id, user.id, 'output', 'Output');
      await appendWorkflowEvent(project.id, user.id, {
        type: 'project_created',
        stage_id: selected.stages[0]?.id ?? '',
      });

      // What was attached before the project existed. The project is made
      // by now, so a file that will not store is reported, not a reason to
      // take the project back out (6 Oct, email 9): its text is already in
      // the context, and the file can be added again on the first stage.
      const failed: string[] = [];
      for (const { file, preview } of startFiles) {
        try {
          await attachProjectFile(project, file, preview);
        } catch (e) {
          failed.push(`${file.name} (${e instanceof Error && e.message ? e.message : 'not stored'})`);
        }
      }
      for (const { file, caption } of startImages) {
        let width = 0;
        let height = 0;
        try {
          const bitmap = await createImageBitmap(file);
          width = bitmap.width;
          height = bitmap.height;
          bitmap.close();
        } catch {
          // Stored all the same; its size is just unknown.
        }
        try {
          await attachProjectFile(project, file, imagePreview(file.name, caption, width, height));
        } catch (e) {
          failed.push(`${file.name} (${e instanceof Error && e.message ? e.message : 'not stored'})`);
        }
      }
      if (failed.length) {
        setCreatedWithFailures({ id: project.id, failed });
        setWorking(null);
        return;
      }

      // What the user confirmed in the front door is the project's initial record.
      if (initialFacts.length) await recordFacts(project, initialFacts);
      await clearSetupDraft(user.id).catch(() => undefined);
      router.push(`/projects/${project.id}`);
    } catch (e) {
      // Four writes, not one transaction: a failure part-way left a project
      // with no workflow pinned and no history, and pressing Start again made
      // a second one. Take the half-made one back out, so a retry starts clean.
      if (createdId) await hardDeleteProject(createdId).catch(() => undefined);
      const reason = e instanceof Error && e.message ? e.message : 'Could not create the project.';
      setError(`${reason} Nothing was created — press Start to try again.`);
      setWorking(null);
    }
  }


  const busyLabel =
    working === 'questions' ? 'Thinking of questions…' : working === 'setup' ? 'Working out a setup…' : null;

  // With a recommendation the user can start from the top; choosing the
  // workflow yourself still ends the form with Start (Harold, via Sean, 9 Oct).
  const startAtTop = Boolean(recommendedKey) && selected?.key === recommendedKey;
  const startButton = (
    <button
      onClick={() => void handleCreate()}
      disabled={!selected || working !== null || !user || !draft.objective.trim() || createdWithFailures !== null}
      className="rounded-xl bg-[var(--pm-primary)] px-6 py-3 text-title text-[var(--on-primary)] transition-opacity hover:opacity-90 disabled:opacity-40"
    >
      {working === 'creating' ? 'Creating…' : `Start ${selected?.name ?? 'project'}`}
    </button>
  );

  return (
    <main className="mx-auto max-w-[860px] px-6 py-14">
      <Link
        href="/projects"
        className="mb-10 inline-flex items-center gap-1.5 text-body text-[var(--on-surface-variant)] transition-colors hover:text-[var(--on-surface)]"
      >
        <span className="material-symbols-outlined text-[18px]">arrow_back</span>
        Projects
      </Link>

      {kept && (
        <div role="region" aria-label="Unfinished setup" className="mb-6 rounded-xl bg-[var(--surface-container-high)] px-5 py-4 text-body text-[var(--on-surface)]">
          <p>{describeDraft(kept.data, kept.updated_at)}</p>
          {(kept.data.attachedNames?.length ?? 0) > 0 && (
            <p className="mt-1 text-label text-[var(--on-surface-variant)]">
              Files are not kept in a draft — attach {kept.data.attachedNames!.length === 1 ? 'it' : 'them'} again: {kept.data.attachedNames!.join(', ')}.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={restoreKept} className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label font-semibold text-[var(--on-primary)]">
              Continue where I left off
            </button>
            <button onClick={discardKept} className="rounded-lg px-4 py-2 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-highest)]">
              Discard the draft
            </button>
          </div>
        </div>
      )}

      {!kept && draftSaved && (
        <p role="status" aria-label="Setup draft" className="mb-4 text-label text-[var(--on-surface-variant)]">
          <span aria-hidden className="material-symbols-outlined mr-1 align-[-3px] text-[16px]">
            {draftSaved === 'failed' ? 'cloud_off' : 'cloud_done'}
          </span>
          {draftSaved === 'saving'
            ? 'Saving your setup…'
            : draftSaved === 'saved'
              ? 'Your setup is saved as a draft — you can sign out and continue later. Nothing is created until you press Start.'
              : 'Your setup could not be saved as a draft; it is kept on this page until you leave.'}
        </p>
      )}

      {error && (
        <div role="alert" className="mb-6 rounded-xl bg-[var(--error-container)] px-4 py-3 text-body text-[var(--on-error-container)]">
          {error}
        </div>
      )}

      {createdWithFailures && (
        <div role="alert" className="mb-6 rounded-xl bg-[var(--error-container)] px-4 py-3 text-body text-[var(--on-error-container)]">
          <p>
            The project was created, but {createdWithFailures.failed.length === 1 ? 'this file' : 'these files'} could
            not be stored: {createdWithFailures.failed.join('; ')}. Any text in them is already in the project context;
            add the file again on the first stage if you need it there.
          </p>
          <Link href={`/projects/${createdWithFailures.id}`} className="mt-2 inline-block font-medium underline">
            Open the project
          </Link>
        </div>
      )}

      {templatesError && (
        <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--error-container)] px-4 py-3 text-body text-[var(--on-error-container)]">
          <span>The workflows could not be loaded, so a project can&apos;t be started yet. ({templatesError})</span>
          <button
            type="button"
            onClick={loadTemplates}
            disabled={loadingTemplates}
            className="rounded-lg bg-[var(--surface-container-lowest)] px-3 py-1.5 text-label text-[var(--on-surface)] disabled:opacity-60"
          >
            {loadingTemplates ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}

      {step === 'ask' && (
        <>
          <h1 className="text-display text-[var(--on-surface)]">What do you want to do or figure out?</h1>
          <p className="mt-3 text-body text-[var(--on-surface-variant)]">
            Say it in your own words. PromptMaster will suggest how to set it up — which workflow,
            how to think about it, who it is for — and you can change any of it.
          </p>

          <div className="mt-8 rounded-2xl bg-[var(--surface-container-lowest)] px-6 py-5 shadow-[0_1px_2px_rgba(25,28,30,0.04)]">
            <AutoGrowTextarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              rows={3}
              autoFocus
              aria-label="What do you want to do or figure out?"
              placeholder="e.g. Write a short book about giraffes for curious ten-year-olds"
              className="w-full bg-transparent text-title leading-relaxed text-[var(--on-surface)] outline-none placeholder:text-[var(--outline)]"
            />
            <LimitCounter length={objective.length} limit={INPUT_LIMITS.objective} />
            <StartAttachments
              files={startFiles}
              images={startImages}
              onFiles={setStartFiles}
              onImages={setStartImages}
              disabled={working !== null}
            />
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button
              onClick={() => void recommend()}
              disabled={!hasObjective || working !== null}
              className="rounded-2xl bg-[var(--pm-primary)] px-6 py-5 text-left text-[var(--on-primary)] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <span className="block text-title">I know what I want to do</span>
              <span className="mt-1 block text-label opacity-90">Recommend a setup from what I wrote</span>
            </button>
            <button
              onClick={() => void guideMe()}
              disabled={!hasObjective || working !== null}
              className="rounded-2xl bg-[var(--surface-container-high)] px-6 py-5 text-left text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-highest)] disabled:opacity-40"
            >
              <span className="block text-title">Guide me — ask me questions</span>
              <span className="mt-1 block text-label text-[var(--on-surface-variant)]">
                One question at a time, then a setup
              </span>
            </button>
            <button
              onClick={() => { setError(null); setStep('talk'); }}
              disabled={!hasObjective || working !== null}
              className="rounded-2xl bg-[var(--surface-container-high)] px-6 py-5 text-left text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-highest)] disabled:opacity-40 sm:col-span-2"
            >
              <span className="block text-title">Keep this as a conversation for now</span>
              <span className="mt-1 block text-label text-[var(--on-surface-variant)]">
                Talk it through; a draft brief builds up beside the chat, and nothing is created until you say so
              </span>
            </button>
          </div>

          {busyLabel && (
            <p role="status" className="mt-4 text-body text-[var(--on-surface-variant)]">
              {busyLabel}
            </p>
          )}

          <button
            onClick={chooseYourself}
            disabled={templates.length === 0}
            className="mt-6 text-body text-[var(--on-surface-variant)] underline-offset-4 hover:text-[var(--on-surface)] hover:underline"
          >
            Or choose the workflow yourself
          </button>
        </>
      )}

      {step === 'questions' && (
        <>
          <h1 className="text-display text-[var(--on-surface)]">A few questions</h1>
          <p className="mt-3 mb-8 text-body text-[var(--on-surface-variant)]">
            About: <span className="text-[var(--on-surface)]">{objective.trim()}</span>. Answer what
            you can — one at a time, and you can stop whenever you like.
          </p>
          <GuideInterview
            objective={objective.trim()}
            material={material}
            busy={working === 'setup'}
            onDone={(given) => void recommend(given)}
            onBack={() => setStep('ask')}
          />
        </>
      )}

      {step === 'talk' && (
        <>
          <h1 className="text-display text-[var(--on-surface)]">Talk it through</h1>
          <p className="mt-3 mb-8 text-body text-[var(--on-surface-variant)]">
            PromptMaster asks one useful question at a time and keeps a draft brief of what you say. When it is
            right, you confirm what becomes the project&apos;s starting record.
          </p>
          <FrontDoor
            key={`fd-${restoredAt}`}
            opening={objective}
            onReady={fromConversation}
            onBack={() => setStep('ask')}
            initialState={frontDoorState}
            onStateChange={setFrontDoorState}
          />
        </>
      )}

      {step === 'setup' && (
        <>
          <h1 className="text-display text-[var(--on-surface)]">Your setup</h1>
          <p className="mt-3 mb-8 text-body text-[var(--on-surface-variant)]">
            {recommendedKey
              ? 'Recommended from what you told us. Start now, or change anything first — all of it stays editable later.'
              : 'Pick a workflow and fill in what you know. All of it stays editable later.'}
          </p>
          <SetupCard
            start={startAtTop ? startButton : undefined}
            templates={templates}
            templateId={templateId}
            onSelectTemplate={setTemplateId}
            workflowReason={workflowReason}
            recommendedKey={recommendedKey}
            draft={draft}
            rationale={rationale}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            designer={
              <>
                {/* A saved workflow of the user's own can be edited as a copy (6 Oct, email 11). */}
                {selected?.key.startsWith('custom_') && copying?.id !== selected.id && (
                  <button
                    type="button"
                    onClick={() => setCopying(selected)}
                    className="mt-3 mr-4 inline-flex items-center gap-1.5 text-body text-[var(--pm-primary)] hover:underline"
                  >
                    <span aria-hidden className="material-symbols-outlined text-[18px]">edit</span>
                    Edit a copy of {selected.name}
                  </button>
                )}
                <CustomWorkflowDesigner
                  key={`${copying?.id ?? 'new'}-${restoredAt}`}
                  initialState={copying ? null : designerState}
                  onStateChange={copying ? undefined : setDesignerState}
                  objective={draft.objective}
                  ownerId={user?.id ?? null}
                  initial={copying ? designFromTemplate(copying) : null}
                  onPublished={(t) => {
                    setTemplates((prior) => [...prior, t]);
                    setTemplateId(t.id);
                    setCopying(null);
                  }}
                />
              </>
            }
          />
          {initialFacts.length > 0 && (
            <section aria-label="Initial facts" className="mt-8 rounded-2xl bg-[var(--surface-container-low)] px-5 py-4">
              <p className="text-title text-[var(--on-surface)]">These become the project&apos;s accepted facts</p>
              <p className="mt-1 text-label text-[var(--on-surface-variant)]">From your conversation; every stage reads them. You can change or take out any of them later.</p>
              <ul className="mt-2 list-disc pl-5 text-label text-[var(--on-surface)]">
                {initialFacts.map((f) => (
                  <li key={f.statement}>{f.kind === 'requirement' ? <span className="font-semibold">Requirement: </span> : null}{f.statement}</li>
                ))}
              </ul>
            </section>
          )}
          <div className="mt-10 flex items-center gap-3">
            {!startAtTop && startButton}
            <button
              onClick={() => setStep('ask')}
              className="px-3 py-3 text-body text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]"
            >
              Back
            </button>
          </div>
        </>
      )}
    </main>
  );
}
