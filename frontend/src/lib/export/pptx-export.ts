/**
 * The deliverable as a PowerPoint file (the client's call, 4 Nov: testers ask for
 * slide decks, and one asked for "a presentation, or at least the content for
 * one" and got text).
 *
 * Client-side, like the Word export, with the library loaded only when the button
 * is pressed. It reads the Markdown the app already assembles
 * (`toManuscriptMarkdown`): each heading at the deck's slide level is a slide,
 * with its bullets, one table and its speaker notes. Nothing here names a
 * workflow: any deliverable with at least three such headings can be downloaded
 * this way, so a deck written by a quick answer gets one too. Pictures, charts
 * and theming are left to whoever opens the file.
 */

export interface DeckSlide {
  title: string;
  bullets: string[];
  table: string[][] | null;
  notes: string;
}

export interface Deck {
  title: string;
  slides: DeckSlide[];
}

/** Fewer than this and the document is not a deck, whatever its headings say. */
export const MIN_SLIDES = 3;

const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
/** A whole line in bold naming a slide: "**Slide 3: Where we stand**". */
const BOLD_SLIDE = /^\*\*\s*(slide\s+\d+\b.*?)\s*\*\*\s*$/i;
const NOTES = /^(?:[-*]\s+)?(?:\*\*|__)?\s*(?:speaker\s+)?notes?\s*(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.*)$/i;
const NOTES_HEADING = /^(?:speaker\s+)?notes?$/i;
const BULLET = /^\s*(?:[-*+•]|\d+[.)])\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?[\s:|-]+\|?\s*$/;

/** The words without the Markdown around them. A deck shows them as written, not with asterisks. */
function plain(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|\s)\*([^*\s][^*]*?)\*(?=\s|[.,;:!?)]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

/** "Slide 3: Where we stand" is a slide titled "Where we stand". */
function slideTitle(raw: string): string {
  return plain(raw).replace(/^slide\s+\d+\s*[:.\-–—]\s*/i, '').trim() || plain(raw);
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => plain(c));
}

/** The heading level that holds the slides: the shallowest one used at least MIN_SLIDES times. */
function slideLevel(lines: readonly string[]): number | 'bold' | null {
  const counts = [0, 0, 0, 0];
  let bold = 0;
  for (const line of lines) {
    const heading = HEADING.exec(line);
    if (heading && !NOTES_HEADING.test(plain(heading[2]))) counts[heading[1].length] += 1;
    if (BOLD_SLIDE.test(line.trim())) bold += 1;
  }
  for (const level of [1, 2, 3]) if (counts[level] >= MIN_SLIDES) return level;
  return bold >= MIN_SLIDES ? 'bold' : null;
}

/**
 * The slides a document holds, or none if it is not laid out as slides. Pure.
 * Anything before the first slide is not on a slide, apart from a top-level title.
 */
export function deckFromMarkdown(markdown: string): Deck {
  const lines = markdown.split('\n');
  const level = slideLevel(lines);
  const firstHeading = lines.map((l) => HEADING.exec(l)).find(Boolean);
  const title = firstHeading && firstHeading[1].length === 1 && level !== 1 ? plain(firstHeading[2]) : '';
  if (level === null) return { title, slides: [] };

  const slides: DeckSlide[] = [];
  let slide: DeckSlide | null = null;
  let inNotes = false;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = HEADING.exec(line);
    const bold = BOLD_SLIDE.exec(line.trim());
    const startsSlide = level === 'bold' ? Boolean(bold) : Boolean(heading && heading[1].length === level && !NOTES_HEADING.test(plain(heading[2])));
    if (startsSlide) {
      slide = { title: slideTitle(level === 'bold' ? bold![1] : heading![2]), bullets: [], table: null, notes: '' };
      slides.push(slide);
      inNotes = false;
      continue;
    }
    if (!slide) continue;
    if (heading && NOTES_HEADING.test(plain(heading[2]))) {
      inNotes = true;
      continue;
    }
    const notes = NOTES.exec(line.trim());
    if (notes) {
      inNotes = true;
      slide.notes = [slide.notes, plain(notes[1])].filter(Boolean).join('\n');
      continue;
    }
    const text = line.trim();
    if (!text || /^-{3,}$/.test(text) || /^\*{3,}$/.test(text)) continue;
    if (inNotes) {
      slide.notes = [slide.notes, plain(text.replace(BULLET, '$1'))].filter(Boolean).join('\n');
      continue;
    }
    if (TABLE_ROW.test(line)) {
      if (TABLE_RULE.test(line)) continue;
      slide.table = [...(slide.table ?? []), cells(line)];
      continue;
    }
    if (heading) {
      slide.bullets.push(plain(heading[2]));
      continue;
    }
    const bullet = BULLET.exec(line);
    slide.bullets.push(plain(bullet ? bullet[1] : text));
  }
  return { title, slides };
}

/** Whether a document can be offered as a deck. */
export function isDeck(markdown: string): boolean {
  return deckFromMarkdown(markdown).slides.length >= MIN_SLIDES;
}

const INK = '1B1B1F';
const QUIET = '5F6368';
const ACCENT = '004AC6';
const RULE = 'D0D5DD';
const RIGHT_TO_LEFT = /[֐-ࣿ]/;

type OutputType = 'blob' | 'arraybuffer';

/** The deck as a file. The library is loaded here, when someone asks for one. */
export async function deckToPptx(deck: Deck, fallbackTitle: string, outputType: 'arraybuffer'): Promise<ArrayBuffer>;
export async function deckToPptx(deck: Deck, fallbackTitle: string, outputType?: 'blob'): Promise<Blob>;
export async function deckToPptx(deck: Deck, fallbackTitle: string, outputType: OutputType = 'blob'): Promise<Blob | ArrayBuffer> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  const title = deck.title || fallbackTitle;
  pptx.title = title;
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };
  const rtl = RIGHT_TO_LEFT.test([title, ...deck.slides.map((s) => s.title)].join(' '));
  const direction = rtl ? { rtlMode: true, align: 'right' as const } : {};

  const cover = pptx.addSlide();
  cover.addText(title, { x: 0.8, y: 2.6, w: 11.7, h: 1.6, fontFace: FONT, fontSize: 40, bold: true, color: INK, fit: 'shrink', ...direction });
  cover.addShape(pptx.ShapeType.rect, { x: rtl ? 11.1 : 0.8, y: 4.3, w: 1.4, h: 0.06, fill: { color: ACCENT } });

  for (const s of deck.slides) {
    const page = pptx.addSlide();
    page.addText(s.title, { x: 0.6, y: 0.35, w: 12.1, h: 1.1, fontFace: FONT, fontSize: 28, bold: true, color: INK, valign: 'top', fit: 'shrink', ...direction });
    page.addShape(pptx.ShapeType.rect, { x: rtl ? 11.5 : 0.6, y: 1.5, w: 1.2, h: 0.05, fill: { color: ACCENT } });

    const hasBullets = s.bullets.length > 0;
    if (hasBullets) {
      page.addText(
        s.bullets.map((text, i) => ({ text, options: { bullet: true, breakLine: i < s.bullets.length - 1, paraSpaceAfter: 10 } })),
        { x: 0.6, y: 1.75, w: 12.1, h: s.table ? 2.2 : 5.1, fontFace: FONT, fontSize: s.bullets.length <= 3 ? 22 : 20, color: INK, valign: 'top', fit: 'shrink', ...direction }
      );
    }
    if (s.table?.length) {
      const widest = Math.max(...s.table.map((r) => r.length));
      const rows = s.table.map((row, r) =>
        Array.from({ length: widest }, (_, c) => ({
          text: row[c] ?? '',
          options: { bold: r === 0, color: r === 0 ? INK : QUIET },
        }))
      );
      page.addTable(rows, {
        x: 0.6,
        y: hasBullets ? 4.05 : 1.8,
        w: 12.1,
        fontFace: FONT,
        fontSize: 14,
        border: { type: 'solid', pt: 0.5, color: RULE },
        autoPage: false,
      });
    }
    if (s.notes) page.addNotes(s.notes);
  }
  const written = await pptx.write({ outputType });
  return written as Blob | ArrayBuffer;
}
