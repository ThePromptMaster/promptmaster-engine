'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Files dropped on, or pasted into, a part of the page (15 Nov, Sean: "Can we
 * have it so we can copy n paste photos or drag to bring files into the chats
 * or the workspace?"). Each place that has an Attach button passes the element
 * it covers and the same function its button calls, so a dropped or pasted file
 * is checked, read and stored exactly as a picked one.
 *
 * A paste with no files in it (ordinary text) is left alone. A drop is taken by
 * the innermost zone it lands in: the side chat inside the workspace takes it,
 * not the workspace around it.
 *
 * A page's main zone may also be `pageWide` (16 Nov, hand pass): a click on blank
 * space leaves the focus on the page itself, so Cmd+V there never reached the
 * stage, and a file dropped beside the stage column made the browser open it and
 * leave the page. Such a zone also takes a paste or drop no other zone took,
 * except a paste into a text box, which is that box's. The last page-wide zone
 * mounted is the one that takes it.
 */

/** The files in a paste or a drop. */
export function filesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = Array.from(data.files ?? []);
  if (files.length) return files;
  // Some browsers put a pasted screenshot only in `items`.
  return Array.from(data.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((f): f is File => Boolean(f));
}

/** The page-wide zones mounted, latest last: only the latest takes the page's files. */
const pageTakers: object[] = [];

/** Whether a paste landed in a place that takes typing. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.tagName === 'SELECT';
}

/** Whether a drag carries files (not text or a link being moved). */
function carriesFiles(data: DataTransfer | null): boolean {
  return Boolean(data && Array.from(data.types ?? []).includes('Files'));
}

/**
 * Listen for dropped and pasted files on `zone`. Returns whether files are
 * being dragged over it, for a visible hint.
 */
export function useFileDrop(
  zone: RefObject<HTMLElement | null> | undefined,
  onFiles: (files: File[]) => void,
  enabled = true,
  options: { pageWide?: boolean } = {}
): boolean {
  const pageWide = Boolean(options.pageWide);
  const [over, setOver] = useState(false);
  const latest = useRef(onFiles);
  useEffect(() => {
    latest.current = onFiles;
  }, [onFiles]);

  useEffect(() => {
    const el = zone?.current;
    if (!el || !enabled) return;
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return;
      e.preventDefault();
      depth += 1;
      setOver(true);
    };
    const overHandler = (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const drop = (e: DragEvent) => {
      const files = filesFrom(e.dataTransfer);
      depth = 0;
      setOver(false);
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      latest.current(files);
    };
    const paste = (e: ClipboardEvent) => {
      const files = filesFrom(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      latest.current(files.map((f) => namedForPaste(f)));
    };
    el.addEventListener('dragenter', enter);
    el.addEventListener('dragover', overHandler);
    el.addEventListener('dragleave', leave);
    el.addEventListener('drop', drop);
    el.addEventListener('paste', paste);
    return () => {
      el.removeEventListener('dragenter', enter);
      el.removeEventListener('dragover', overHandler);
      el.removeEventListener('dragleave', leave);
      el.removeEventListener('drop', drop);
      el.removeEventListener('paste', paste);
    };
  }, [zone, enabled]);

  useEffect(() => {
    if (!pageWide || !enabled || typeof document === 'undefined') return;
    const token = {};
    pageTakers.push(token);
    const mine = () => pageTakers[pageTakers.length - 1] === token;
    const overHandler = (e: DragEvent) => {
      if (!mine() || !carriesFiles(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const drop = (e: DragEvent) => {
      if (!mine() || e.defaultPrevented) return;
      const files = filesFrom(e.dataTransfer);
      setOver(false);
      if (!files.length) return;
      e.preventDefault();
      latest.current(files);
    };
    const paste = (e: ClipboardEvent) => {
      if (!mine() || e.defaultPrevented || isTypingTarget(e.target)) return;
      const files = filesFrom(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      latest.current(files.map((f) => namedForPaste(f)));
    };
    document.addEventListener('dragover', overHandler);
    document.addEventListener('drop', drop);
    document.addEventListener('paste', paste);
    return () => {
      document.removeEventListener('dragover', overHandler);
      document.removeEventListener('drop', drop);
      document.removeEventListener('paste', paste);
      const at = pageTakers.indexOf(token);
      if (at >= 0) pageTakers.splice(at, 1);
    };
  }, [pageWide, enabled]);

  return over;
}

/** A pasted screenshot arrives as "image.png"; two in a row would clash, so each gets the time it was pasted. */
export function namedForPaste(file: File, now = new Date()): File {
  if (file.name && file.name !== 'image.png' && file.name !== 'image.jpeg') return file;
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const ext = file.type === 'image/jpeg' ? '.jpg' : file.type === 'image/png' ? '.png' : file.name.slice(file.name.lastIndexOf('.')) || '.png';
  return new File([file], `pasted-${stamp}${ext}`, { type: file.type, lastModified: file.lastModified });
}
