/**
 * The manuscript as a Word document (C4, Sean 28 Sep item 15: "I need to
 * see my book and pull it out as a Word or PDF file").
 *
 * Client-side, with the `docx` package loaded only when the button is
 * pressed — the backend stays a stateless LLM proxy and the project page does
 * not carry a document library it uses once. The Markdown the app already
 * assembles (`toManuscriptMarkdown`) is the source; the mapping is the plain
 * one — headings, paragraphs, bullets — and anything richer (tables, code)
 * arrives as text. Fidelity beyond that is a known limitation, not a promise.
 */

export type DocBlock =
  | { kind: 'title' | 'h1' | 'h2' | 'h3' | 'paragraph' | 'bullet'; text: string }
  /** An image placed on its own line as `![caption](project-file:<id>)`. */
  | { kind: 'image'; id: string; text: string };

/** An image's bytes, ready to embed. `type` is what Word can hold; others are captioned instead. */
export interface DocImage {
  data: ArrayBuffer;
  type: 'png' | 'jpg' | 'gif' | null;
  width: number;
  height: number;
}

const IMAGE_LINE = /^!\[([^\]]*)\]\(project-file:([0-9a-f-]{8,})\)$/i;
/** Word's text width on an A4/Letter page at default margins, in pixels. */
const PAGE_WIDTH_PX = 600;

/** Markdown headings, paragraphs and bullets, as blocks. Pure. */
export function markdownToBlocks(markdown: string): DocBlock[] {
  const blocks: DocBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: inline(paragraph.join(' ')) });
    paragraph = [];
  };
  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const image = IMAGE_LINE.exec(line.trim());
    if (image) {
      flush();
      blocks.push({ kind: 'image', id: image[2], text: image[1] });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      blocks.push({ kind: level === 1 ? 'title' : level === 2 ? 'h1' : 'h2', text: inline(heading[2]) });
      continue;
    }
    const deeper = /^#{4,6}\s+(.*)$/.exec(line);
    if (deeper) {
      flush();
      blocks.push({ kind: 'h3', text: inline(deeper[1]) });
      continue;
    }
    const bullet = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      blocks.push({ kind: 'bullet', text: inline(bullet[1]) });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

/** Strip the inline Markdown a reader would not want to see literally. */
function inline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
    .replace(/(^|[^_])_([^_]+)_/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
}

/** Build the .docx. Loads `docx` on demand; returns the file as a Blob. */
export async function manuscriptToDocx(
  markdown: string,
  title: string,
  images: Record<string, DocImage> = {}
): Promise<Blob> {
  const docx = await import('docx');
  const { Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } = docx;
  const blocks = markdownToBlocks(markdown);
  const children = blocks.flatMap((b) => {
    switch (b.kind) {
      case 'image': {
        const img = images[b.id];
        const caption = new Paragraph({ children: [new TextRun({ text: b.text, italics: true })], spacing: { after: 200 } });
        if (!img?.type) return [new Paragraph({ children: [new TextRun({ text: `[Image: ${b.text}]`, italics: true })] })];
        const scale = img.width > PAGE_WIDTH_PX ? PAGE_WIDTH_PX / img.width : 1;
        return [
          new Paragraph({
            children: [
              new ImageRun({
                type: img.type,
                data: img.data,
                transformation: { width: Math.round((img.width || PAGE_WIDTH_PX) * scale), height: Math.round((img.height || 400) * scale) },
                altText: { name: b.text, description: b.text, title: b.text },
              }),
            ],
          }),
          caption,
        ];
      }
      case 'title':
        return new Paragraph({ text: b.text, heading: HeadingLevel.TITLE });
      case 'h1':
        return new Paragraph({ text: b.text, heading: HeadingLevel.HEADING_1, pageBreakBefore: true });
      case 'h2':
        return new Paragraph({ text: b.text, heading: HeadingLevel.HEADING_2 });
      case 'h3':
        return new Paragraph({ text: b.text, heading: HeadingLevel.HEADING_3 });
      case 'bullet':
        return new Paragraph({ children: [new TextRun(b.text)], bullet: { level: 0 } });
      default:
        return new Paragraph({ children: [new TextRun(b.text)], spacing: { after: 200 } });
    }
  }) as InstanceType<typeof Paragraph>[];
  const doc = new Document({
    creator: 'PromptMaster',
    title,
    sections: [{ children }],
  });
  return Packer.toBlob(doc);
}
