'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { api } from '@/lib/api/client';
import { AutoGrowTextarea } from '@/components/shared/auto-grow-textarea';
import { INPUT_LIMITS } from '@/lib/projects/input-limits';
import { MarkdownOutput } from '@/components/shared/markdown-output';
import type { NewSource } from '@/lib/supabase/sources';
import { useT } from '@/lib/i18n/i18n-provider';
import type { MessageKey } from '@/lib/i18n/messages/en';

export interface DraftBrief {
  objective: string;
  audience: string;
  requirements: string[];
  evidence: string[];
  deliverables: string[];
  stages: string[];
  approvals: string[];
}

export const EMPTY_BRIEF: DraftBrief = { objective: '', audience: '', requirements: [], evidence: [], deliverables: [], stages: [], approvals: [] };

/** The outline's parts, as the backend names them. */
export type BriefField = keyof DraftBrief;

/** A turn; an assistant turn may carry a piece of writing to use as it stands (10 Oct, email 1). */
export type Turn = { role: 'user' | 'assistant'; content: string; draft?: string; web?: FrontDoorSearch };

/** A search a reply made (22 Oct): what for, and what it found that is new to the conversation. */
export interface FrontDoorSearch {
  query: string;
  sources: NewSource[];
  /** Set when the search failed and the reply was made without it. */
  note?: string;
}

/**
 * Every source the conversation's searches found, in the order they are cited
 * ([S1], [S2], …): sent with each turn, and saved to the project when it is made.
 */
export function sourcesFound(turns: readonly Turn[]): NewSource[] {
  return turns.flatMap((t) => t.web?.sources ?? []);
}

export interface FrontDoorState {
  turns: Turn[];
  brief: DraftBrief;
  ready: boolean;
  /** Parts of the outline the user edited: kept as they wrote them (14 Oct call). */
  edited?: BriefField[];
}

const LISTS: { field: Exclude<BriefField, 'objective' | 'audience'>; title: MessageKey; add: MessageKey }[] = [
  { field: 'requirements', title: 'door.requirements', add: 'door.addRequirement' },
  { field: 'evidence', title: 'door.evidence', add: 'door.addFact' },
  { field: 'deliverables', title: 'door.deliverables', add: 'door.addDeliverable' },
  { field: 'stages', title: 'door.stages', add: 'door.addStage' },
  { field: 'approvals', title: 'door.approvals', add: 'door.addApproval' },
];

/**
 * The start of every project: a conversation, with an outline beside it.
 *
 * "Keep this as a conversation for now" (Sean, 6 Oct, email 8) was one of
 * three ways in, hidden in the advanced setup. On the 14 Oct call Sean asked
 * for it to be the way in: "they just start off like they normally would …
 * and if it has an outline on the side … then they can shift over to more of
 * a project level." So the first message is sent as soon as the user starts,
 * the outline beside the chat can be edited directly (a part the user edits
 * is theirs — the backend keeps it as written), and one button turns it into
 * a project. Nothing is saved as project state until that button.
 */
export function FrontDoor({
  opening,
  onReady,
  onReview,
  onBack,
  initialState = null,
  onStateChange,
  material = '',
  attach,
  busyLabel,
}: {
  opening: string;
  /** `said`: the user's own turns, to tell what they said from what the brief's drafter assumed. */
  onReady: (brief: DraftBrief, transcript: string, said: string, turns: Turn[]) => void;
  /** The same brief, to the full setup screen first. */
  onReview?: (brief: DraftBrief, transcript: string, said: string, turns: Turn[]) => void;
  onBack: () => void;
  /** A conversation kept from an earlier visit (U2). */
  initialState?: FrontDoorState | null;
  /** Told of every change, so the page can keep the setup between visits. */
  onStateChange?: (state: FrontDoorState) => void;
  /** The words of what the user attached, read with every turn. */
  material?: string;
  /** The attach control, in the composer. */
  attach?: ReactNode;
  /** Set while the page is making the project: the button says so and nothing else can be pressed. */
  busyLabel?: string | null;
}) {
  const t = useT();
  const [turns, setTurns] = useState<Turn[]>(initialState?.turns ?? []);
  const [brief, setBrief] = useState<DraftBrief>(initialState?.brief ?? EMPTY_BRIEF);
  const [ready, setReady] = useState(initialState?.ready ?? false);
  const [edited, setEdited] = useState<BriefField[]>(initialState?.edited ?? []);
  useEffect(() => {
    onStateChange?.({ turns, brief, ready, edited });
  }, [turns, brief, ready, edited, onStateChange]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (given?: string) => {
    const text = (given ?? draft).trim();
    if (!text || busy) return;
    const next: Turn[] = [...turns, { role: 'user', content: text }];
    setTurns(next);
    if (given === undefined) setDraft('');
    setBusy(true);
    setError(null);
    try {
      // The model reads back its own drafts with the conversation.
      const sent = next.map((t) => ({ role: t.role, content: t.draft ? `${t.content}\n\nDRAFT YOU WROTE:\n${t.draft}` : t.content }));
      // A new project has Web access on (22 Oct), so the conversation that
      // starts one searches as its side chat will.
      const res = await api.frontDoor({
        turns: sent,
        brief,
        edited,
        ...(material.trim() ? { material } : {}),
        web_access: 'on',
        sources: sourcesFound(turns),
      });
      const web = res.web_query || res.web_note ? { query: res.web_query ?? '', sources: res.web_sources ?? [], ...(res.web_note ? { note: res.web_note } : {}) } : null;
      setTurns([
        ...next,
        { role: 'assistant', content: res.reply, ...(res.draft?.trim() ? { draft: res.draft.trim() } : {}), ...(web ? { web } : {}) },
      ]);
      setBrief(res.brief);
      setReady(res.ready);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t('door.failed'));
    } finally {
      setBusy(false);
    }
  };

  // The first message is what the user typed to start: sent at once, as a
  // chat would, not left in the box for a second press.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || turns.length || !opening.trim()) return;
    opened.current = true;
    void send(opening);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const edit = (field: BriefField, value: string | string[]) => {
    setBrief((b) => ({ ...b, [field]: value }));
    setEdited((e) => (e.includes(field) ? e : [...e, field]));
  };

  const transcript = turns.map((t) => `${t.role === 'user' ? 'Me' : 'PromptMaster'}: ${t.content}`).join('\n\n');
  // What the user typed into the outline is theirs as much as what they said:
  // a requirement added there is never recorded as PromptMaster's assumption.
  const said = [
    ...turns.filter((t) => t.role === 'user').map((t) => t.content),
    ...edited.flatMap((f) => (Array.isArray(brief[f]) ? (brief[f] as string[]) : [brief[f] as string])),
  ].join('\n');
  const making = Boolean(busyLabel);

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_300px]">
      <section aria-label={t('door.conversation')} className="rounded-2xl bg-[var(--surface-container-lowest)] px-5 py-4">
        <div className="space-y-3">
          {turns.length === 0 && !busy && (
            <p className="text-body text-[var(--on-surface-variant)]">
              {t('door.intro')}
            </p>
          )}
          {turns.map((t, i) =>
            t.role === 'user' ? (
              <p key={i} className="ml-8 whitespace-pre-wrap rounded-xl bg-[var(--surface-container-high)] px-4 py-2 text-body text-[var(--on-surface)]">
                {t.content}
              </p>
            ) : (
              <div key={i} className="mr-8 space-y-2">
                <div className="rounded-xl bg-[var(--surface-container-low)] px-4 py-2 text-body text-[var(--on-surface)]">
                  <MarkdownOutput content={t.content} />
                </div>
                {t.draft && <DraftBlock text={t.draft} />}
                {t.web && <SearchNote search={t.web} first={sourcesFound(turns.slice(0, i)).length + 1} />}
              </div>
            )
          )}
          {busy && <p role="status" className="text-label text-[var(--on-surface-variant)]">{t('door.thinking')}</p>}
        </div>
        <div className="mt-4 flex items-end gap-2">
          <AutoGrowTextarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, INPUT_LIMITS.message))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            aria-label={t('door.message')}
            className="min-w-0 flex-1 resize-none rounded-lg bg-[var(--surface-container-low)] px-3 py-2 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40"
          />
          <button onClick={() => void send()} disabled={!draft.trim() || busy || making} className="rounded-lg bg-[var(--pm-primary)] px-4 py-2 text-label text-[var(--on-primary)] disabled:opacity-40">
            {t('door.send')}
          </button>
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-label text-[var(--on-surface-variant)]">
          <span aria-hidden className="material-symbols-outlined text-[16px]">travel_explore</span>
          <span>{t('door.web')}</span>
        </p>
        {attach && <div className="mt-2">{attach}</div>}
        {error && <p role="alert" className="mt-2 text-label text-[var(--pm-error)]">{error}</p>}
        <button onClick={onBack} className="mt-4 text-label text-[var(--on-surface-variant)] hover:underline">{t('start.back')}</button>
      </section>

      <aside aria-label={t('door.briefLabel')} className="h-fit rounded-2xl bg-[var(--surface-container-low)] px-5 py-4">
        <p className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">{t('door.outlineTitle')}</p>
        <p className="mt-1 text-label text-[var(--on-surface-variant)]">{t('door.outlineNote')}</p>

        <label className="mt-3 block text-label font-semibold text-[var(--on-surface)]" htmlFor="outline-objective">{t('door.objective')}</label>
        <AutoGrowTextarea
          id="outline-objective"
          value={brief.objective}
          onChange={(e) => edit('objective', e.target.value.slice(0, INPUT_LIMITS.objective))}
          rows={2}
          placeholder={t('door.objectivePlaceholder')}
          className="mt-1 w-full resize-none rounded-lg bg-[var(--surface-container-lowest)] px-2.5 py-1.5 text-body text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40"
        />
        <label className="mt-2 block text-label font-semibold text-[var(--on-surface)]" htmlFor="outline-audience">{t('door.for')}</label>
        <input
          id="outline-audience"
          value={brief.audience}
          onChange={(e) => edit('audience', e.target.value.slice(0, 1000))}
          placeholder={t('door.forPlaceholder')}
          className="mt-1 w-full rounded-lg bg-[var(--surface-container-lowest)] px-2.5 py-1.5 text-label text-[var(--on-surface)] outline-none focus:ring-2 focus:ring-[var(--pm-primary)]/40"
        />
        {LISTS.map(({ field, title, add }) => (
          <OutlineList key={field} title={t(title)} addLabel={t(add)} items={brief[field]} onChange={(items) => edit(field, items)} />
        ))}

        {brief.objective.trim() && (
          <>
            <button
              onClick={() => onReady(brief, transcript, said, turns)}
              disabled={busy || making}
              className={`mt-4 w-full rounded-lg px-4 py-2 text-label font-semibold disabled:opacity-60 ${ready ? 'bg-[var(--pm-primary)] text-[var(--on-primary)]' : 'bg-[var(--surface-container-high)] text-[var(--on-surface)]'}`}
            >
              {busyLabel ?? t('door.make')}
            </button>
            <p className="mt-1.5 text-label text-[var(--on-surface-variant)]">
              {ready ? `${t('door.enough')} ` : ''}{t('door.record')}
            </p>
            {onReview && (
              <button
                onClick={() => onReview(brief, transcript, said, turns)}
                disabled={busy || making}
                className="mt-2 text-label text-[var(--on-surface-variant)] underline-offset-4 hover:underline disabled:opacity-60"
              >
                {t('door.review')}
              </button>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

/** One list in the outline: each item editable in place, removable, and one more to add. */
function OutlineList({ title, addLabel, items, onChange }: { title: string; addLabel: string; items: string[]; onChange: (items: string[]) => void }) {
  const [adding, setAdding] = useState('');
  const t = useT();
  const add = () => {
    const text = adding.trim();
    if (!text) return;
    if (!items.includes(text)) onChange([...items, text]);
    setAdding('');
  };
  return (
    <div className="mt-3">
      <p className="text-label font-semibold text-[var(--on-surface)]">{title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-1">
            <input
              aria-label={`${title} ${i + 1}`}
              value={item}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value.slice(0, 600) : x)))}
              onBlur={() => !items[i].trim() && onChange(items.filter((_, j) => j !== i))}
              className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-0.5 text-label text-[var(--on-surface-variant)] outline-none hover:bg-[var(--surface-container-lowest)] focus:bg-[var(--surface-container-lowest)] focus:ring-1 focus:ring-[var(--pm-primary)]/40"
            />
            <button
              type="button"
              aria-label={t('door.removeItem', { item })}
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="rounded p-0.5 text-[var(--on-surface-variant)] hover:bg-[var(--surface-container-high)]"
            >
              <span aria-hidden className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </li>
        ))}
      </ul>
      <input
        aria-label={addLabel}
        value={adding}
        onChange={(e) => setAdding(e.target.value.slice(0, 600))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder={`+ ${addLabel.toLowerCase()}`}
        className="mt-1 w-full rounded-md bg-transparent px-1.5 py-0.5 text-label text-[var(--on-surface)] outline-none placeholder:text-[var(--outline)] focus:bg-[var(--surface-container-lowest)] focus:ring-1 focus:ring-[var(--pm-primary)]/40"
      />
    </div>
  );
}

/** What a reply searched for, and the sources it found, numbered as the reply cites them. */
export function SearchNote({ search, first }: { search: FrontDoorSearch; first: number }) {
  const t = useT();
  return (
    <div className="text-label text-[var(--on-surface-variant)]">
      <p className="flex items-start gap-1.5">
        <span aria-hidden className="material-symbols-outlined text-[16px]">{search.note ? 'public_off' : 'travel_explore'}</span>
        <span>
          {search.note ||
            t('door.searched', {
              query: search.query,
              found: search.sources.length ? t('door.newSources', { count: search.sources.length }) : t('door.noSources'),
            })}
        </span>
      </p>
      {search.sources.length > 0 && (
        <ol className="mt-1 space-y-0.5 pl-6">
          {search.sources.map((s, i) => (
            <li key={s.url} className="break-words">
              [S{first + i}]{' '}
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-[var(--on-surface)]">
                {s.title || s.url}
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** A piece of writing to use as it stands, apart from the explanation, with a copy button. */
function DraftBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const t = useT();
  return (
    <section aria-label={t('door.draft')} className="rounded-xl bg-[var(--surface-container-lowest)] px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-label uppercase tracking-wider text-[var(--on-surface-variant)]">{t('door.draft')}</p>
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => undefined)}
          className="flex items-center gap-1 rounded-lg bg-[var(--surface-container-high)] px-3 py-1 text-label text-[var(--on-surface)]"
        >
          <span aria-hidden className="material-symbols-outlined text-[16px]">content_copy</span>
          {copied ? t('door.copied') : t('door.copy')}
        </button>
      </div>
      <div className="mt-2 text-body text-[var(--on-surface)]">
        <MarkdownOutput content={text} />
      </div>
    </section>
  );
}
