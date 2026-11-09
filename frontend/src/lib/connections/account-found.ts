import { api } from '@/lib/api/client';
import { useProjectStore } from '@/stores/project-store';
import type { ThirdPartyItem } from '@/types';

import { mergeThirdParty } from './items';

/**
 * A project searches its owner's connected accounts while its switch is on (8 Nov,
 * L-203): the side chat and a draft the person asked for, never Go.
 *
 * The backend writes the search and reads the best matches. What comes back is saved
 * to the project before the work that used it, like a web search's sources, so a
 * later prompt can read what [T n] was, and the person can see it and remove it.
 */

export interface AccountUse {
  account_query?: string;
  account_items?: ThirdPartyItem[];
  account_note?: string;
}

/** A search a writer made, as the page shows it. */
export interface AccountFound {
  query: string;
  /** Opened and used by this piece of work. */
  read: number;
  /** Of those, how many are now held: a full project keeps none. */
  kept: number;
  note?: string;
}

const FRESH_MS = 5 * 60_000;
let known: Promise<boolean> | null = null;
let askedAt = 0;

/** Whether anything is connected. Asked rarely, so an unconnected person's chat makes no extra model call. */
export function hasConnectedAccount(): Promise<boolean> {
  if (known && Date.now() - askedAt < FRESH_MS) return known;
  askedAt = Date.now();
  const asking = Promise.resolve()
    .then(() => api.listConnections())
    .then(({ accounts }) => accounts.some((a) => a.status === 'ACTIVE'))
    .catch(() => {
      known = null;
      return false;
    });
  known = asking;
  return asking;
}

/** After connecting or disconnecting. */
export function forgetConnectedAccount(): void {
  known = null;
}

/** The switch, as a writer's request sends it: off with nothing connected. */
export async function accountSearchOf(project: { account_search?: 'on' | 'off' | null }): Promise<'on' | 'off'> {
  return project.account_search === 'on' && (await hasConnectedAccount()) ? 'on' : 'off';
}

/** Save what a search read. Never throws: an item that won't save costs its place in the panel, not the work. */
export async function keepAccountItems(projectId: string, res: AccountUse): Promise<AccountFound | null> {
  if (!res.account_query && !res.account_note) return null;
  const items = res.account_items ?? [];
  const found: AccountFound = { query: res.account_query ?? '', read: items.length, kept: 0, ...(res.account_note ? { note: res.account_note } : {}) };
  if (!items.length) return found;
  try {
    const store = useProjectStore.getState();
    if (store.projectId !== projectId || !store.project) return found;
    const held = store.project.third_party ?? [];
    const { items: merged } = mergeThirdParty(held, items);
    found.kept = merged.length - held.length;
    if (found.kept) {
      store.patchProject({ third_party: merged });
      await store.flush();
    }
  } catch {
    found.kept = 0;
  }
  return found;
}

/** The search as a line on a version's summary. */
export function accountLine(found: AccountFound | null): string {
  if (!found) return '';
  if (!found.query) return found.note ?? '';
  const did = `Searched your accounts for “${found.query}” · ${found.read ? `read ${found.read}` : 'nothing opened'}.`;
  return found.note ? `${did} ${found.note}` : did;
}
