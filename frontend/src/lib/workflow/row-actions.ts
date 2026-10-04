/**
 * What a side-chat action would do to a table, worked out before anything is
 * saved. Pure.
 *
 * On a table stage the chat could only answer; "Change it" is off, and the
 * Apply chips sent the rows through a prose rewrite (1 Oct, item 15: "the
 * side chat should ideally translate reasoning into structured row updates").
 * An action from `/api/suggest-actions` names rows and what to set on them;
 * this turns it into the rows as they would be and a plain list of what
 * changes, which the user reads before saving it as a new version.
 */

import { emptyItem, statusOption, type StageItem, type StageItemSchema } from './stage-artifact';
import type { ReplyAction } from '@/types';

export interface RowChange {
  id: string;
  /** What the row is, in the user's words: its first field. */
  title: string;
  added: boolean;
  /** "Status: Not looked at → Not run", "Why: …", "What actually happened: … → …". */
  lines: string[];
}

export interface RowActionPreview {
  items: StageItem[];
  changes: RowChange[];
}

const clip = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function titleOf(item: StageItem, schema: StageItemSchema): string {
  const first = schema.fields.map((f) => (item[f.key] ?? '').trim()).find(Boolean);
  return clip(first ?? `(${schema.itemLabel})`, 90);
}

/**
 * Apply an action to the rows. Anything the table cannot hold is left out: a
 * row that is not there, a status the user could not choose themselves, a
 * status that needs a reason and has none, a field the table does not have.
 * The server filters the same way; this is the client not trusting that.
 */
export function previewRowAction(items: readonly StageItem[], action: ReplyAction, schema: StageItemSchema): RowActionPreview {
  const keys = new Set(schema.fields.map((f) => f.key));
  const max = new Map(schema.fields.map((f) => [f.key, f.max]));
  const label = new Map(schema.fields.map((f) => [f.key, f.label]));
  const fit = (key: string, value: string) => (max.get(key) ? value.slice(0, max.get(key)) : value);
  const changes: RowChange[] = [];

  if (action.kind === 'add_rows') {
    const added: StageItem[] = [];
    for (const row of action.rows ?? []) {
      const item = emptyItem(schema);
      const lines: string[] = [];
      for (const [key, value] of Object.entries(row)) {
        if (!keys.has(key) || !value.trim()) continue;
        item[key] = fit(key, value.trim());
        lines.push(`${label.get(key)}: ${clip(item[key]!)}`);
      }
      if (!lines.length) continue;
      // A row the model wrote starts where every generated row starts.
      const start = schema.statuses?.find((s) => s.modelDefault);
      if (start) {
        item.status = start.value;
        item.status_source = 'model';
      }
      added.push(item);
      changes.push({ id: item.id, title: titleOf(item, schema), added: true, lines });
    }
    return { items: [...items, ...added], changes };
  }

  if (action.kind !== 'row_updates') return { items: [...items], changes };

  const updates = new Map((action.updates ?? []).map((u) => [u.id, u]));
  const next = items.map((item) => {
    const update = updates.get(item.id);
    if (!update) return item;
    const row: StageItem = { ...item };
    const lines: string[] = [];

    for (const [key, value] of Object.entries(update.fields ?? {})) {
      const text = fit(key, value.trim());
      if (!keys.has(key) || !text || text === (item[key] ?? '')) continue;
      lines.push(`${label.get(key)}: ${clip(item[key] ?? '') || '(empty)'} → ${clip(text)}`);
      row[key] = text;
    }

    const option = statusOption(schema, update.status);
    const reason = (update.reason ?? '').trim();
    if (option && option.settable !== false && !option.requiresExecution && !option.legacy && (!option.requiresReason || reason)) {
      const was = statusOption(schema, item.status)?.label ?? 'Not looked at';
      if (item.status !== option.value || (option.requiresReason && reason !== (item.reason ?? ''))) {
        lines.push(`Status: ${was} → ${option.label}`);
        if (option.requiresReason) lines.push(`Why: ${clip(reason)}`);
        row.status = option.value;
        row.reason = option.requiresReason ? reason : undefined;
        // The user reads the change and saves it: it is theirs.
        row.status_source = 'user';
      }
    }

    if (!lines.length) return item;
    changes.push({ id: item.id, title: titleOf(item, schema), added: false, lines });
    return row;
  });
  return { items: next, changes };
}
