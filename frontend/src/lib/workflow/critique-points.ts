/**
 * "Buttonize it" (PM-22). Sean, Sep 10: "creative ways to let users click
 * output and have it applied as they go, instead of needing to manually rework
 * each step."
 *
 * A critique (Challenge, Reframe, Self-audit) is prose the model wrote. Its
 * list items are the actionable parts, so each becomes a point with its own
 * Apply. Pure: the same text always yields the same points, in order.
 */

import type { AuditFinding } from '@/types';

export interface CritiquePoint {
  id: string;
  /** The point itself — usually the item's first line. */
  text: string;
  /** The explanation the critique gave under it, when it gave one. */
  detail?: string;
  /** The section it sits in ("Unstated assumptions"), when the critique had sections. */
  group?: string;
}

const LIST_ITEM = /^(\s*)([-*+]|\d{1,2}[.)])\s+(.*)$/;
const BOLD_ONLY = /^\*\*[^*]+\*\*:?$/;
const MIN_CHARS = 15;
const MAX_POINTS = 20;

/** Markdown emphasis and link syntax off; the words stay. */
function plain(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|\s)[*_](\S.*?\S)[*_](?=\s|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/:$/, '')
    .trim();
}

interface Item {
  indent: number;
  numbered: boolean;
  raw: string;
  detail: string[];
}

/**
 * Real critiques nest: "1. **Unstated assumptions**" is a section, the bullets
 * under it are the points, and the indented lines under a bullet explain it.
 * A bold-only item with deeper items after it is a section label, not a point;
 * indented prose under an item is that item's detail.
 */
export function pointsFromCommentary(markdown: string): CritiquePoint[] {
  const items: Item[] = [];
  let current: Item | null = null;
  for (const line of markdown.split('\n')) {
    const match = LIST_ITEM.exec(line);
    if (match) {
      current = {
        indent: match[1].replace(/\t/g, '  ').length,
        numbered: /\d/.test(match[2]),
        raw: match[3].trim(),
        detail: [],
      };
      items.push(current);
      continue;
    }
    if (!line.trim()) continue;
    // Indented prose continues the item above it; flush-left prose ends the list.
    if (current && /^\s+\S/.test(line)) current.detail.push(line.trim());
    else current = null;
  }

  const points: CritiquePoint[] = [];
  const groups: { indent: number; numbered: boolean; label: string }[] = [];
  // A section ends at the next item that is shallower, or at the same depth
  // and of the label's own kind ("2. **Weak reasoning**" ends section 1).
  const ends = (g: { indent: number; numbered: boolean }, item: Item) =>
    item.indent < g.indent || (item.indent === g.indent && item.numbered === g.numbered);
  items.forEach((item, i) => {
    while (groups.length && ends(groups[groups.length - 1], item)) groups.pop();
    const next = items[i + 1];
    // A bold-only item is a section label when what follows is deeper, or a
    // different kind of list at the same depth (numbered sections with
    // bulleted points is the common shape).
    const isLabel =
      BOLD_ONLY.test(item.raw) &&
      !item.detail.length &&
      next !== undefined &&
      (next.indent > item.indent || next.numbered !== item.numbered);
    if (isLabel) {
      groups.push({ indent: item.indent, numbered: item.numbered, label: plain(item.raw) });
      return;
    }
    const text = plain(item.raw);
    const detail = plain(item.detail.join(' '));
    if ((text + detail).length < MIN_CHARS || points.length >= MAX_POINTS) return;
    points.push({
      id: `p${points.length + 1}`,
      text,
      ...(detail ? { detail } : {}),
      ...(groups.length ? { group: groups[groups.length - 1].label } : {}),
    });
  });
  return points;
}

/** A critique point in the shape the apply endpoint already takes. */
export function findingFromPoint(point: CritiquePoint, source: string): AuditFinding {
  return {
    id: point.id,
    category: point.group ? `${source} — ${point.group}` : source,
    summary: point.detail ? `${point.text} — ${point.detail}` : point.text,
    suggested_change: 'Revise the draft so this point is addressed.',
  };
}
