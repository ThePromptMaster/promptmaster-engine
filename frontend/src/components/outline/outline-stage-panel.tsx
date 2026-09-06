'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { OutlineEditor } from './outline-editor';
import { OutlineHistory } from './outline-history';
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
import type { OutlineDocument, SectionDraftBinding } from '@/types/outline';
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

  useEffect(() => {
    let live = true;
    setLoading(true);
    ensureOutlineArtifact(project.id, project.user_id, stageId)
      .then(async (found) => {
        const rows = await listVersions(found.id);
        if (!live) return;
        setArtifact(found);
        setVersions(rows);
        setDraft(found.outline_draft ? coerceOutlineDocument(found.outline_draft) : null);
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
      await onEventsChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not approve the outline.');
    } finally {
      setBusy(false);
    }
  }, [commit, project.id, project.user_id, stageId, events.length, onEventsChanged]);

  const handleRegenerateAll = useCallback(async () => {
    setRegeneratingAll(true);
    setError(null);
    try {
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
  }, [project, doc, drafts, edit]);

  const handleRegenerateItem = useCallback(
    async (itemId: string) => {
      const index = doc.items.findIndex((i) => i.id === itemId);
      if (index === -1) return;

      setRegeneratingItemId(itemId);
      setError(null);
      try {
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
    [doc, project, edit]
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

      <OutlineEditor
        document={doc}
        onChange={edit}
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
