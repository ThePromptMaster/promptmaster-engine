'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DerivedOutlineNotice } from './derived-outline-notice';
import { OutlineEditor } from './outline-editor';
import { OutlineHistory } from './outline-history';
import { derivedOutlineDrift } from '@/lib/workflow/derived-outline';
import { api } from '@/lib/api/client';
import {
  applyItemRegeneration,
  coerceOutlineDocument,
  emptyDocument,
  mergeRegeneratedOutline,
  outlineHistory,
  parseOutlineDocument,
  staleDrafts,
} from '@/lib/outline/model';
import { applyOutlineEdit } from '@/lib/outline/use-outline-draft';
import {
  approveOutlineVersion,
  approvedOutlineVersionId,
  commitOutlineVersion,
  ensureOutlineArtifact,
  outlineApprovals,
  saveOutlineDraft,
} from '@/lib/supabase/outline';
import { listVersions } from '@/lib/supabase/versions';
import type { OutlineDocument, OutlineItem, SectionDraftBinding } from '@/types/outline';
import type { Artifact, ArtifactVersion, Project } from '@/types/project';
import type { PMInput } from '@/types';
import type { WorkflowEvent } from '@/lib/workflow/types';

/**
 * The outline stage, wired.
 *
 * Deliberately loads its own artifact rather than reading one from the project
 * store: the store's artifact loading is being reshaped to index artifacts by
 * stage, and an outline stage that owns its own (project, stage, 'outline') row
 * needs nothing from that work to be correct.
 *
 * `derived` is the only thing separating a Book outline from a Research one,
 * and it changes where the starting point comes from — not what happens
 * afterwards. Derived or hand-built, the outline is committed as an ordinary
 * artifact version, approved by an ordinary `outline_approved` event, and drafted
 * by the same job queue. There is no second path downstream of this component,
 * which is what lets Research inherit FR-05 resumption for free.
 */

const DRAFT_SAVE_DELAY_MS = 800;

interface Props {
  project: Project;
  stageId: string;
  events: WorkflowEvent[];
  /** Called after an approval, so the workspace can re-read the event log. */
  onEventsChanged?: () => void | Promise<void>;
  /** Prose already written, per outline item. Owned by the drafting surface. */
  drafts?: SectionDraftBinding[];
  onRewriteSection?: (itemId: string) => void;
  /**
   * Derived mode (`outline_stage: 'derived'`).
   *
   * A pure function of the template and the stages already completed. Supplied
   * as a callback rather than a value so the panel can re-run it — that is what
   * makes "the source stage changed" answerable without a model call.
   */
  derive?: () => OutlineItem[];
  /**
   * Called after an approval, with the version and the document it pinned.
   *
   * The outline lives in `artifact_versions`; drafting reads
   * `artifacts.long_form`. Approving has to materialise one into the other, and
   * the caller owns that write because it owns the drafting artifact.
   */
  onApproved?: (version: ArtifactVersion, doc: OutlineDocument) => void | Promise<void>;
  readOnly?: boolean;
}

function inputsFor(project: Project): PMInput {
  return {
    objective: project.objective,
    audience: project.audience,
    constraints: project.constraints,
    output_format: project.output_format,
    mode: project.mode,
    custom_name: project.custom_name,
    custom_preamble: project.custom_preamble,
    custom_tone: project.custom_tone,
    session_facts: project.session_facts,
  };
}

export function OutlineStagePanel({
  project,
  stageId,
  events,
  onEventsChanged,
  drafts = [],
  onRewriteSection,
  derive,
  onApproved,
  readOnly = false,
}: Props) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [versions, setVersions] = useState<ArtifactVersion[]>([]);
  const [draft, setDraft] = useState<OutlineDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regeneratingItemId, setRegeneratingItemId] = useState<string | null>(null);
  const [regeneratingAll, setRegeneratingAll] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read inside the load effect without making the derivation a dependency of
  // it: re-deriving is cheap and deterministic, but re-fetching the artifact
  // every time the parent re-renders is not.
  const deriveRef = useRef(derive);
  useEffect(() => {
    deriveRef.current = derive;
  }, [derive]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    ensureOutlineArtifact(project.id, project.user_id, stageId)
      .then(async (found) => {
        const rows = await listVersions(found.id);
        if (!live) return;
        setArtifact(found);
        setVersions(rows);

        const saved = found.outline_draft ? coerceOutlineDocument(found.outline_draft) : null;
        // The derivation is the starting point on a stage that has never been
        // opened. It is NOT written to the database here: it is a pure function
        // of work already recorded, so re-deriving it on the next visit gives
        // the same document, and a draft row for something nobody has touched
        // is a row that can go stale on its own.
        const seed = deriveRef.current;
        if (!saved && rows.length === 0 && seed) {
          const items = seed();
          setDraft(items.length ? { ...emptyDocument(), items } : null);
        } else {
          setDraft(saved);
        }
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Could not open the outline.'))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [project.id, project.user_id, stageId]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    []
  );

  const approvals = useMemo(() => outlineApprovals(events), [events]);
  const approvedVersionId = useMemo(() => approvedOutlineVersionId(events), [events]);
  const approvedIds = useMemo(() => new Set(approvals.map((a) => a.outline_version_id)), [approvals]);

  const head = versions.at(-1) ?? null;
  const headDocument = useMemo(
    () => (head ? parseOutlineDocument(head.content) : emptyDocument()),
    [head]
  );
  const headApproved = head ? approvedIds.has(head.id) : false;
  const doc = draft ?? headDocument;

  const approvedVersion = versions.find((v) => v.id === approvedVersionId) ?? null;
  const forkedFrom = draft?.forked_from_version_id
    ? (versions.find((v) => v.id === draft.forked_from_version_id)?.version_number ?? null)
    : null;

  /**
   * Has the work behind this outline moved since it was approved?
   *
   * Only asked once there IS an approved version — before that the outline is
   * still a draft and re-deriving it costs nothing to say. Reported, never
   * applied: silently re-deriving over an approved outline would pull the plan
   * out from under a half-written paper.
   */
  const drift = useMemo(() => {
    if (!derive || !approvedVersion) return null;
    const report = derivedOutlineDrift(parseOutlineDocument(approvedVersion.content).items, derive());
    return report.stale ? report : null;
  }, [derive, approvedVersion]);

  const history = useMemo(() => outlineHistory(versions, approvals), [versions, approvals]);
  const stale = useMemo(
    () => staleDrafts(drafts, approvedVersionId, versions),
    [drafts, approvedVersionId, versions]
  );

  /** Persist the working copy. Debounced: typing must not be a write per keystroke. */
  const scheduleDraftSave = useCallback(
    (next: OutlineDocument | null) => {
      if (!artifact) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveOutlineDraft(artifact, next).catch(() =>
          setError('Your outline changes are not being saved. Copy anything important.')
        );
      }, DRAFT_SAVE_DELAY_MS);
    },
    [artifact]
  );

  const edit = useCallback(
    (next: OutlineDocument) => {
      setDraft((current) => {
        const applied = applyOutlineEdit(
          { head: headDocument, headVersionId: head?.id ?? null, headApproved, draft: current },
          next
        );
        scheduleDraftSave(applied);
        return applied;
      });
    },
    [headDocument, head, headApproved, scheduleDraftSave]
  );

  /** Commit the working copy as a version. Returns the version, or the head if nothing changed. */
  const commit = useCallback(
    async (summary: string): Promise<ArtifactVersion | null> => {
      if (!artifact) return null;
      if (!draft) return head;

      const created = await commitOutlineVersion(artifact, draft, {
        sourceOperation: 'outline_edit',
        changeSummary: summary,
        model: project.model,
        mode: project.mode,
      });
      setVersions((v) => [...v, created]);
      setArtifact((a) =>
        a
          ? {
              ...a,
              current_version_id: created.id,
              version_count: created.version_number,
              outline_draft: null,
              revision: a.revision + 2,
            }
          : a
      );
      setDraft(null);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      return created;
    },
    [artifact, draft, head, project.model, project.mode]
  );

  const handleSaveDraft = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await commit(`${(draft ?? headDocument).items.length} sections`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the outline.');
    } finally {
      setBusy(false);
    }
  }, [commit, draft, headDocument]);

  const handleApprove = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // Approval always pins a saved version. Approving unsaved edits would
      // bind drafting to something that exists only in this tab.
      const version = await commit('Approved outline');
      if (!version) throw new Error('Save the outline before approving it.');

      await approveOutlineVersion(
        project.id,
        project.user_id,
        stageId,
        version,
        events.length + 1
      );
      // After the event, so a failure to materialise leaves an approval that
      // can be retried rather than a drafting state bound to nothing.
      await onApproved?.(version, parseOutlineDocument(version.content));
      await onEventsChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not approve the outline.');
    } finally {
      setBusy(false);
    }
  }, [commit, project.id, project.user_id, stageId, events.length, onEventsChanged, onApproved]);

  const handleRegenerateAll = useCallback(async () => {
    setRegeneratingAll(true);
    setError(null);
    try {
      // Derived outlines re-derive; they never call a model. The merge is the
      // same one the generated path uses, so a section that has left the
      // outline still lands in the orphan tray with its prose intact.
      if (derive) {
        edit(
          mergeRegeneratedOutline(
            doc,
            derive(),
            drafts.filter((d) => d.word_count > 0).map((d) => d.item_id)
          )
        );
        return;
      }
      const { outline } = await api.generateOutline({
        inputs: inputsFor(project),
        suggested_section_count: Math.max(doc.items.length, 3),
        model: project.model,
      });
      edit(
        mergeRegeneratedOutline(
          doc,
          outline.map((s) => ({ title: s.title, abstract: s.abstract })),
          drafts.filter((d) => d.word_count > 0).map((d) => d.item_id)
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not regenerate the outline.');
    } finally {
      setRegeneratingAll(false);
    }
  }, [project, doc, drafts, edit, derive]);

  const handleRegenerateItem = useCallback(
    async (itemId: string) => {
      const index = doc.items.findIndex((i) => i.id === itemId);
      if (index === -1) return;

      setRegeneratingItemId(itemId);
      setError(null);
      try {
        // Derived: take this item's brief from a fresh derivation, matched by
        // id rather than position. Positions move when the user reorders; the
        // id is what the section is.
        if (derive) {
          const fresh = derive().find((i) => i.id === itemId);
          if (!fresh) {
            throw new Error('No stage feeds this section any more — edit it here instead.');
          }
          edit(
            applyItemRegeneration(doc, itemId, { title: fresh.title, abstract: fresh.abstract })
          );
          return;
        }
        // One item, one call. The outline endpoint is the only generator that
        // exists today, so an alternative for this position is taken from a
        // fresh outline of the same length and everything else is left alone —
        // including the item's id, so its prose stays attached. Swaps for an
        // item-scoped generator without touching anything above this line.
        const { outline } = await api.generateOutline({
          inputs: inputsFor(project),
          suggested_section_count: doc.items.length,
          model: project.model,
        });
        const fresh = outline[index];
        if (!fresh) throw new Error('The model returned a shorter outline.');
        edit(applyItemRegeneration(doc, itemId, { title: fresh.title, abstract: fresh.abstract }));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not regenerate that section.');
      } finally {
        setRegeneratingItemId(null);
      }
    },
    [doc, project, edit, derive]
  );

  const handleDiscardDraft = useCallback(() => {
    setDraft(null);
    scheduleDraftSave(null);
  }, [scheduleDraftSave]);

  if (loading) {
    return (
      <p className="rounded-2xl bg-[var(--surface-container-lowest)] px-6 py-10 text-center text-body text-[var(--on-surface-variant)]">
        Opening the outline…
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-[var(--surface-container-low)] px-5 py-3 text-body text-[var(--pm-error)]"
        >
          {error}
        </p>
      )}

      {drift && (
        <DerivedOutlineNotice
          drift={drift}
          onRederive={readOnly ? undefined : handleRegenerateAll}
          busy={regeneratingAll || busy}
        />
      )}

      <OutlineEditor
        document={doc}
        onChange={edit}
        readOnly={readOnly}
        drafts={drafts}
        staleDrafts={stale}
        onRewriteSection={onRewriteSection}
        isDraft={draft !== null}
        headVersionNumber={head?.version_number ?? null}
        approvedVersionNumber={approvedVersion?.version_number ?? null}
        forkedFromVersionNumber={forkedFrom}
        busy={busy}
        onSaveDraft={handleSaveDraft}
        onDiscardDraft={handleDiscardDraft}
        onApprove={handleApprove}
        onRegenerateAll={handleRegenerateAll}
        onRegenerateItem={handleRegenerateItem}
        regeneratingItemId={regeneratingItemId}
        regeneratingAll={regeneratingAll}
      />

      <OutlineHistory history={history} approvedVersionId={approvedVersionId} />
    </div>
  );
}
