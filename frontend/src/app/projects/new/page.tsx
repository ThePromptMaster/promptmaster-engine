'use client';

import { formOf } from '@/lib/workflow/work-form';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { GuideInterview } from '@/components/projects/guide-interview';
import { SetupCard, type SetupDraft } from '@/components/projects/setup-card';
import { useWorkflowWords } from '@/components/projects/workflow-picker';
import { useT } from '@/lib/i18n/i18n-provider';
import { getLocale, tr } from '@/lib/i18n/store';
import { CustomWorkflowDesigner } from '@/components/projects/custom-workflow-designer';
import { FrontDoor, type DraftBrief, type Turn } from '@/components/projects/front-door';
import { saveStageChatMessage } from '@/lib/supabase/conversation';
import { saveSources } from '@/lib/supabase/sources';
import type { ProjectSource } from '@/types/project';
import { DraftStatus, type DraftSaveState } from '@/components/projects/draft-status';
import { recordFacts, type NewFact } from '@/lib/supabase/facts';
import { assumedByModel } from '@/lib/workflow/facts';
import { designFromTemplate } from '@/lib/workflow/custom';
import { AutoGrowTextarea } from '@/components/shared/auto-grow-textarea';
import { api } from '@/lib/api/client';
import { createProject, hardDeleteProject } from '@/lib/supabase/projects';
import { setRequestLanguage } from '@/lib/api/language';
import { LANGUAGES, resolveLanguage, startLanguage, type LanguageCode } from '@/lib/workflow/languages';
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
import { SIMPLE_GUIDE_QUESTIONS, useExperience } from '@/lib/projects/experience';
import { sourceAccessNote } from '@/lib/projects/links';
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
  // Simple unless the user chose advanced (Sean, 18 Oct, email 7).
  const [experience, setExperience] = useExperience();
  const simple = experience === 'simple';
  const t = useT();
  const words = useWorkflowWords();

  const [templates, setTemplates] = useState<(WorkflowTemplate & { id: string })[]>([]);
  const [step, setStep] = useState<Step>('ask');
  const [objective, setObjective] = useState('');
  // Client, 21 Oct ("pick your language"): the start screen's conversation and
  // the new project write in this. Someone reading the interface in Spanish
  // writes in Spanish unless they choose otherwise; else the browser's own
  // language when offered.
  const [language, setLanguage] = useState<LanguageCode>('en');
  useEffect(() => {
    setLanguage(startLanguage(getLocale()));
  }, []);
  useEffect(() => {
    setRequestLanguage(language);
    return () => setRequestLanguage('en');
  }, [language]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  /**
   * Facts and requirements the user gave in the front-door conversation and
   * confirmed: recorded as the project's accepted facts when it is created.
   */
  const [initialFacts, setInitialFacts] = useState<NewFact[]>([]);
  /** The conversation the project starts from, kept as its first stage's chat. */
  const [openingChat, setOpeningChat] = useState<Turn[]>([]);
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
  const [draftSaved, setDraftSaved] = useState<DraftSaveState>(null);
  const draftChecked = useRef(false);

  const loadTemplates = useCallback(() => {
    setLoadingTemplates(true);
    setTemplatesError(null);
    listTemplates()
      .then(setTemplates)
      .catch((e) => setTemplatesError(e instanceof Error && e.message ? e.message : tr('start.loadWorkflowsFailed')))
      .finally(() => setLoadingTemplates(false));
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  // An example goal from the empty project list arrives in the URL; it fills the
  // box and nothing more — the user still chooses how to start.
  // 13 Oct (production pass): words typed into the box before the page became
  // interactive were wiped when it did — they are taken from the box first.
  const goalBox = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const typed = goalBox.current?.value ?? '';
    const goal = typed.trim() ? typed.slice(0, INPUT_LIMITS.objective) : goalFromSearch(window.location.search, INPUT_LIMITS.objective);
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
  // The setup screen's own values, under names `create` can tell from what it is given.
  const selectedTemplate = selected;
  const setupDraft = draft;
  const factsSoFar = initialFacts;

  // The setup screen with nothing selected: select what was recommended, so
  // the user is not left to find it again. The list can arrive after the
  // recommendation (a retry), or while it was being worked out — then
  // `recommend` read the list as it was at the click, found nothing, and the
  // screen opened with no workflow chosen and Start at the foot (23 Oct, CI).
  if (step === 'setup' && !templateId && templates.length) {
    setTemplateId((templates.find((t) => t.key === (recommendedKey ?? 'book')) ?? templates[0]).id);
  }
  const hasObjective = objective.trim().length > 0;

  /** A recommended setup for the ask (or the conversation's brief), without applying it. */
  async function suggestSetup(given?: { question: string; answer: string }[], from?: { objective: string; material: string; audience?: string }) {
    const ask = from?.objective ?? objective;
    const brought = [material, from?.material ?? ''].filter(Boolean).join('\n\n');
    const { suggestion } = await api.generateSetup({
      objective: ask.trim(),
      answers: given?.length ? given.slice(0, 8) : undefined,
      ...(brought ? { material: brought } : {}),
    });
    const recommended = templateFor(suggestion.workflow) ?? templateFor('single_output');
    const split = withDocuments(ask);
    const suggested: SetupDraft = {
      title: titleFrom(ask),
      objective: split.objective,
      context: split.context,
      // The audience the user stated in the conversation is theirs; a preset
      // the suggester picked ("Student" for an eleven-year-old) is not (12 Oct, Colette).
      audience: from?.audience?.trim() || suggestion.audience || 'General',
      constraints: suggestion.constraints,
      output_format: suggestion.output_format,
      mode: suggestion.mode,
    };
    return { suggestion, recommended, draft: suggested };
  }

  async function recommend(given?: { question: string; answer: string }[], from?: { objective: string; material: string; audience?: string }) {
    setWorking('setup');
    setError(null);
    try {
      const { suggestion, recommended, draft: suggested } = await suggestSetup(given, from);
      setTemplateId(recommended?.id ?? null);
      setRecommendedKey(suggestion.workflow);
      setWorkflowReason(suggestion.workflow_reason);
      setRationale(suggestion.rationale);
      setDraft(suggested);
      setStep('setup');
    } catch (e) {
      setError(
        t('start.recommendFailed', { why: e instanceof Error && e.message ? `: ${e.message}` : '' })
      );
    } finally {
      setWorking(null);
    }
  }

  /** What the user gave in the conversation, as the project's initial record. */
  function factsFromBrief(brief: DraftBrief, said: string): NewFact[] {
    // A point the brief lists as a requirement is not recorded again as a fact.
    const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9$%]+/g, ' ').trim();
    const required = new Set(brief.requirements.map(norm));
    // What the user did not say is recorded as PromptMaster's assumption (S2b, 18 Oct).
    const origin = (statement: string) => (assumedByModel(statement, said) ? 'model_assumed' as const : 'user_stated' as const);
    return [
      ...brief.requirements.map((statement) => ({ statement, kind: 'requirement' as const, source_kind: 'chat' as const, source_ref: { via: 'front door' }, origin: origin(statement) })),
      ...brief.evidence
        .filter((statement) => !required.has(norm(statement)))
        .map((statement) => ({ statement, kind: 'fact' as const, source_kind: 'chat' as const, source_ref: { via: 'front door' }, origin: origin(statement) })),
    ];
  }

  /** The brief and the conversation, as material for the setup recommendation. */
  function conversationMaterial(brief: DraftBrief, transcript: string): { objective: string; audience: string; material: string } {
    const lines = [
      brief.audience && `Audience: ${brief.audience}`,
      brief.deliverables.length && `Deliverables: ${brief.deliverables.join('; ')}`,
      brief.stages.length && `Stages discussed: ${brief.stages.join(' › ')}`,
      brief.approvals.length && `Approvals wanted: ${brief.approvals.join('; ')}`,
    ].filter(Boolean);
    return { objective: brief.objective, audience: brief.audience, material: [lines.join('\n'), `The conversation:\n${transcript}`].filter(Boolean).join('\n\n') };
  }

  /** "Review the setup first": the brief becomes the setup screen, and its facts the initial record. */
  function fromConversation(brief: DraftBrief, transcript: string, said: string, turns: Turn[]) {
    setObjective(brief.objective);
    setInitialFacts(factsFromBrief(brief, said));
    setOpeningChat(turns);
    void recommend(undefined, conversationMaterial(brief, transcript));
  }

  /**
   * "Make it a project" (14 Oct call: start like a normal chat, then "shift
   * over at one point to more of a project level"). One press: the setup is
   * recommended from the conversation and the project made with it, the
   * conversation coming along as the first stage's chat. The setup screen is
   * still there under "Review the setup first".
   */
  async function makeFromConversation(brief: DraftBrief, transcript: string, said: string, turns: Turn[]) {
    if (!user || working) return;
    setWorking('setup');
    setError(null);
    try {
      const { recommended, draft: suggested } = await suggestSetup(undefined, conversationMaterial(brief, transcript));
      if (!recommended) throw new Error('No workflow is available');
      setWorking(null);
      await create({ template: recommended, draft: suggested, facts: factsFromBrief(brief, said), chat: turns });
    } catch (e) {
      setError(t('start.setUpFailed', { why: e instanceof Error && e.message ? `: ${e.message}` : '' }));
      setWorking(null);
    }
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

  function handleCreate() {
    if (working || createdWithFailures) return;
    void create();
  }

  /** Make the project: from the setup screen, or with what the conversation produced. */
  async function create(given?: { template: WorkflowTemplate & { id: string }; draft: SetupDraft; facts: NewFact[]; chat: Turn[] }) {
    const selected = given?.template ?? selectedTemplate;
    const draft = given?.draft ?? setupDraft;
    const initialFacts = given?.facts ?? factsSoFar;
    const chat = given?.chat ?? openingChat;
    if (!user || !selected || createdWithFailures) return;
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
          // Not when the objective names another form (13 Oct): a screenplay is not a book manuscript.
          output_format: draft.output_format.trim() || (selected.key === 'book' && !formOf({ objective: draft.objective, constraints: draft.constraints }) ? BOOK_OUTPUT_FORMAT : ''),
          mode: draft.mode,
          workflow: selected.key,
          language,
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
      // What its searches found (22 Oct), saved in the order the conversation
      // cited it, so [S1] in the carried-over chat is [S1] under Web sources.
      let found: ProjectSource[] = [];
      for (const t of chat) {
        if (!t.web?.sources.length) continue;
        try {
          found = [...found, ...(await saveSources({ ...project, sources: found }, t.web.sources, { query: t.web.query, stageId: selected.stages[0]?.id ?? null }))];
        } catch (e) {
          failed.push(`web sources found for “${t.web.query}” (${e instanceof Error && e.message ? e.message : 'not stored'})`);
        }
      }
      if (failed.length) {
        setCreatedWithFailures({ id: project.id, failed });
        setWorking(null);
        return;
      }

      // What the user confirmed in the front door is the project's initial record.
      if (initialFacts.length) await recordFacts(project, initialFacts);
      // The conversation it started from comes along, as the first stage's
      // chat (14 Oct call): the user carries on talking where they were.
      const firstStage = selected.stages[0]?.id;
      if (firstStage) {
        for (const t of chat) {
          await saveStageChatMessage({
            project_id: project.id,
            stage_id: firstStage,
            // The stage's first version is 1; the backend refuses a 0.
            iteration_number: 1,
            role: t.role,
            content: t.draft ? `${t.content}\n\n${t.draft}` : t.content,
            mode: 'discuss',
          }).catch(() => undefined);
        }
      }
      await clearSetupDraft(user.id).catch(() => undefined);
      router.push(`/projects/${project.id}`);
    } catch (e) {
      // Four writes, not one transaction: a failure part-way left a project
      // with no workflow pinned and no history, and pressing Start again made
      // a second one. Take the half-made one back out, so a retry starts clean.
      if (createdId) await hardDeleteProject(createdId).catch(() => undefined);
      const reason = e instanceof Error && e.message ? e.message : t('start.createFailed');
      setError(t('start.nothingCreated', { reason }));
      setWorking(null);
    }
  }


  const busyLabel =
    working === 'questions' ? t('start.thinkingQuestions') : working === 'setup' ? t('start.workingSetup') : null;

  // With a recommendation the user can start from the top; choosing the
  // workflow yourself still ends the form with Start (Harold, via Sean, 9 Oct).
  const startAtTop = simple || (Boolean(recommendedKey) && selected?.key === recommendedKey);
  const linkNote = sourceAccessNote(objective);
  const experienceSwitch = (
    <button
      type="button"
      onClick={() => setExperience(simple ? 'advanced' : 'simple')}
      className="text-body text-[var(--on-surface-variant)] underline-offset-4 hover:text-[var(--on-surface)] hover:underline"
    >
      {simple ? t('start.advanced') : t('start.simple')}
    </button>
  );
  const startButton = (
    <button
      onClick={() => void handleCreate()}
      disabled={!selected || working !== null || !user || !draft.objective.trim() || createdWithFailures !== null}
      className="rounded-xl bg-[var(--pm-primary)] px-6 py-3 text-title text-[var(--on-primary)] transition-opacity hover:opacity-90 disabled:opacity-40"
    >
      {working === 'creating' ? t('start.creating') : selected ? t('start.startNamed', { name: words.name(selected) }) : t('start.startProject')}
    </button>
  );

  return (
    <main className="mx-auto max-w-[860px] px-6 py-14">
      <div className="mb-10 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/projects"
          className="inline-flex items-center gap-1.5 text-body text-[var(--on-surface-variant)] transition-colors hover:text-[var(--on-surface)]"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          {t('start.projects')}
        </Link>
        <label className="inline-flex items-center gap-2 text-label text-[var(--on-surface-variant)]">
          <span className="material-symbols-outlined text-[18px]" aria-hidden>translate</span>
          {t('start.writesIn')}
          <select
            aria-label={t('start.writesInLabel')}
            value={language}
            onChange={(e) => setLanguage(resolveLanguage(e.target.value))}
            className="rounded-lg bg-[var(--surface-container-low)] px-3 py-1.5 text-label text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.code === 'en' ? l.name : l.own}</option>
            ))}
          </select>
        </label>
      </div>

      {/* 13 Oct (production pass): an unfinished setup found after the page
          loaded pushed the goal box down under the user's click. On the first
          step it sits below the start buttons, where it moves nothing. */}
      {kept && step !== 'ask' && (
        <div role="region" aria-label={t('start.unfinished')} className="mb-6 rounded-xl bg-[var(--surface-container-high)] px-5 py-4 text-body text-[var(--on-surface)]">
          <p>{describeDraft(kept.data, kept.updated_at)}</p>
          {(kept.data.attachedNames?.length ?? 0) > 0 && (
            <p className="mt-1 text-label text-[var(--on-surface-variant)]">
              {t('start.filesNotKept', { count: kept.data.attachedNames!.length, names: kept.data.attachedNames!.join(', ') })}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={restoreKept} className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label font-semibold text-[var(--on-primary)]">
              {t('start.continueDraft')}
            </button>
            <button onClick={discardKept} className="rounded-lg px-4 py-2 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-highest)]">
              {t('start.discardDraft')}
            </button>
          </div>
        </div>
      )}

      <DraftStatus state={kept ? null : draftSaved} />

      {error && (
        <div role="alert" className="mb-6 rounded-xl bg-[var(--error-container)] px-4 py-3 text-body text-[var(--on-error-container)]">
          {error}
        </div>
      )}

      {createdWithFailures && (
        <div role="alert" className="mb-6 rounded-xl bg-[var(--error-container)] px-4 py-3 text-body text-[var(--on-error-container)]">
          <p>
            {t('start.createdWithFailures', { count: createdWithFailures.failed.length, files: createdWithFailures.failed.join('; ') })}
          </p>
          <Link href={`/projects/${createdWithFailures.id}`} className="mt-2 inline-block font-medium underline">
            {t('start.openProject')}
          </Link>
        </div>
      )}

      {templatesError && (
        <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--error-container)] px-4 py-3 text-body text-[var(--on-error-container)]">
          <span>{t('start.templatesFailed', { reason: templatesError })}</span>
          <button
            type="button"
            onClick={loadTemplates}
            disabled={loadingTemplates}
            className="rounded-lg bg-[var(--surface-container-lowest)] px-3 py-1.5 text-label text-[var(--on-surface)] disabled:opacity-60"
          >
            {loadingTemplates ? t('start.retrying') : t('start.retry')}
          </button>
        </div>
      )}

      {step === 'ask' && (
        <>
          <h1 className="text-display text-[var(--on-surface)]">{simple ? t('start.titleSimple') : t('start.title')}</h1>
          <p className="mt-3 text-body text-[var(--on-surface-variant)]">
            {simple
              ? `${t('start.introSimple')} ${t('setup.doesTheWork')}`
              : t('start.intro')}
          </p>

          <div className="mt-8 rounded-2xl bg-[var(--surface-container-lowest)] px-6 py-5 shadow-[0_1px_2px_rgba(25,28,30,0.04)]">
            <AutoGrowTextarea
              ref={goalBox}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && hasObjective && working === null) {
                  e.preventDefault();
                  setError(null);
                  setStep('talk');
                }
              }}
              rows={3}
              autoFocus
              aria-label={simple ? t('start.titleSimple') : t('start.title')}
              placeholder={t('start.placeholder')}
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
            {/* The backend opens no link; say so before any work rests on one (email 7). */}
            {linkNote && (
              <p role="note" aria-label={t('start.links')} className="mt-3 flex gap-1.5 text-label text-[var(--pm-tertiary)]">
                <span aria-hidden className="material-symbols-outlined text-[16px]">link_off</span>
                {linkNote}
              </p>
            )}
          </div>

          {/* 14 Oct call: start as in any chat — the conversation is the way in,
              with the outline beside it. The other ways stay, one row below. */}
          <div className="mt-4 flex justify-end">
            <button
              onClick={() => { setError(null); setStep('talk'); }}
              disabled={!hasObjective || working !== null}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--pm-primary)] px-6 py-3 text-title text-[var(--on-primary)] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {t('start.startConversation')}
              <span aria-hidden className="material-symbols-outlined text-[20px]">arrow_upward</span>
            </button>
          </div>
          <p className="mt-2 text-right text-label text-[var(--on-surface-variant)]">
            {t('start.conversationNote')}
          </p>

          <p className="mt-8 text-label uppercase tracking-wider text-[var(--on-surface-variant)]">{t('start.skip')}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <button
              onClick={() => void recommend()}
              disabled={!hasObjective || working !== null}
              className="rounded-2xl bg-[var(--surface-container-high)] px-6 py-4 text-left text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-highest)] disabled:opacity-40"
            >
              <span className="block text-title">{simple ? t('start.setItUp') : t('start.know')}</span>
              <span className="mt-1 block text-label text-[var(--on-surface-variant)]">{simple ? t('start.setItUpNote') : t('start.knowNote')}</span>
            </button>
            <button
              onClick={() => void guideMe()}
              disabled={!hasObjective || working !== null}
              className="rounded-2xl bg-[var(--surface-container-high)] px-6 py-4 text-left text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-highest)] disabled:opacity-40"
            >
              <span className="block text-title">{simple ? t('start.askFew') : t('start.guide')}</span>
              <span className="mt-1 block text-label text-[var(--on-surface-variant)]">
                {simple ? t('start.askFewNote', { count: SIMPLE_GUIDE_QUESTIONS }) : t('start.guideNote')}
              </span>
            </button>
          </div>

          {busyLabel && (
            <p role="status" className="mt-4 text-body text-[var(--on-surface-variant)]">
              {busyLabel}
            </p>
          )}

          {kept && (
        <div role="region" aria-label={t('start.unfinished')} className="mt-6 rounded-xl bg-[var(--surface-container-high)] px-5 py-4 text-body text-[var(--on-surface)]">
          <p>{describeDraft(kept.data, kept.updated_at)}</p>
          {(kept.data.attachedNames?.length ?? 0) > 0 && (
            <p className="mt-1 text-label text-[var(--on-surface-variant)]">
              {t('start.filesNotKept', { count: kept.data.attachedNames!.length, names: kept.data.attachedNames!.join(', ') })}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={restoreKept} className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label font-semibold text-[var(--on-primary)]">
              {t('start.continueDraft')}
            </button>
            <button onClick={discardKept} className="rounded-lg px-4 py-2 text-label text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-highest)]">
              {t('start.discardDraft')}
            </button>
          </div>
        </div>
          )}

          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
            {!simple && (
              <button
                onClick={chooseYourself}
                disabled={templates.length === 0}
                className="text-body text-[var(--on-surface-variant)] underline-offset-4 hover:text-[var(--on-surface)] hover:underline"
              >
                {t('start.chooseYourself')}
              </button>
            )}
            {experienceSwitch}
          </div>
        </>
      )}

      {step === 'questions' && (
        <>
          <h1 className="text-display text-[var(--on-surface)]">{t('start.questionsTitle')}</h1>
          <p className="mt-3 mb-8 text-body text-[var(--on-surface-variant)]">
            {t('start.about')} <span className="text-[var(--on-surface)]">{objective.trim()}</span>.{' '}
            {t('start.answerWhatYouCan')}
          </p>
          <GuideInterview
            objective={objective.trim()}
            material={material}
            busy={working === 'setup'}
            onDone={(given) => void recommend(given)}
            onBack={() => setStep('ask')}
            maxQuestions={simple ? SIMPLE_GUIDE_QUESTIONS : undefined}
            foldWhy={simple}
          />
        </>
      )}

      {step === 'talk' && (
        <>
          <h1 className="sr-only">{t('start.talkTitle')}</h1>
          <FrontDoor
            key={`fd-${restoredAt}`}
            opening={objective}
            onReady={(brief, transcript, said, turns) => void makeFromConversation(brief, transcript, said, turns)}
            onReview={fromConversation}
            onBack={() => setStep('ask')}
            initialState={frontDoorState}
            onStateChange={setFrontDoorState}
            material={material}
            busyLabel={working === 'setup' ? t('start.workingTheSetup') : working === 'creating' ? t('start.creatingProject') : null}
            attach={
              <StartAttachments
                files={startFiles}
                images={startImages}
                onFiles={setStartFiles}
                onImages={setStartImages}
                disabled={working !== null}
              />
            }
          />
        </>
      )}

      {step === 'setup' && (
        <>
          <h1 className="text-display text-[var(--on-surface)]">{t('start.setupTitle')}</h1>
          <p className="mt-3 mb-8 text-body text-[var(--on-surface-variant)]">
            {simple
              ? t('start.setupSimple')
              : recommendedKey
              ? t('start.setupRecommended')
              : t('start.setupChoose')}
          </p>
          <SetupCard
            simple={simple}
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
                    {t('start.editCopy', { name: selected.name })}
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
            <section aria-label={t('start.initialFacts')} className="mt-8 rounded-2xl bg-[var(--surface-container-low)] px-5 py-4">
              <p className="text-title text-[var(--on-surface)]">{t('start.factsTitle')}</p>
              <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('start.factsNote')}</p>
              <ul className="mt-2 list-disc pl-5 text-label text-[var(--on-surface)]">
                {initialFacts.map((f) => (
                  <li key={f.statement}>
                    {f.kind === 'requirement' ? <span className="font-semibold">{t('start.requirement')} </span> : null}
                    {f.statement}
                    {f.origin === 'model_assumed' && <span className="ml-1 text-[var(--on-surface-variant)]">{t('start.assumed')}</span>}
                  </li>
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
              {t('start.back')}
            </button>
            {experienceSwitch}
          </div>
        </>
      )}
    </main>
  );
}
