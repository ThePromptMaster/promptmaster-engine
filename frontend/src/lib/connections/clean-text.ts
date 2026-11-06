/**
 * Text from someone else's calendar entry or document, made safe to show and send.
 *
 * What a person sees has to be what a model gets. An attacker's instructions are
 * easiest to hide in what a screen does not draw: an HTML element styled away, or
 * zero-width and tag characters that read as nothing. So all of it comes out here,
 * before the user is ever asked what to send. Pure.
 */

/** Marks that draw nothing: zero-width, direction overrides, variation selectors, tag characters. */
const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]|[\u{E0000}-\u{E0FFF}]/gu;
/** Control characters, except the tab and newline a person can see. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export const MAX_ITEM_CHARS = 8_000;

export function cleanText(text: string | null | undefined, max = MAX_ITEM_CHARS): string {
  return (text ?? '')
    .replace(INVISIBLE, '')
    .replace(CONTROL, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

const HIDDEN_STYLE = /(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?\s*(?:;|$)|font-size\s*:\s*0)/i;

/** What a person would read if this HTML were drawn: no hidden elements, no markup. */
export function visibleText(html: string | null | undefined, max = MAX_ITEM_CHARS): string {
  if (!html) return '';
  if (!/<[a-z!/]/i.test(html)) return cleanText(html, max);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, template, noscript, head, [hidden], [aria-hidden="true"]').forEach((el) => el.remove());
  doc.querySelectorAll('[style]').forEach((el) => {
    if (HIDDEN_STYLE.test(el.getAttribute('style') ?? '')) el.remove();
  });
  doc.querySelectorAll('br').forEach((el) => el.replaceWith('\n'));
  doc.querySelectorAll('p, div, li, tr').forEach((el) => el.append('\n'));
  return cleanText(doc.body?.textContent ?? '', max);
}
