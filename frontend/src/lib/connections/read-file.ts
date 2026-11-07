import { extractText } from '@/lib/data/extract-text';

import type { ConnectedFile, ConnectedText, Skipped } from './items';

/**
 * Text from someone else's file, made safe to show and send: the browser's half
 * of `promptmaster/connections.clean_text`, for the PDFs and Office files the
 * backend hands over rather than parses.
 *
 * What a person sees has to be what a model gets. Instructions hide in what a
 * screen does not draw, so zero-width, direction and tag characters come out;
 * links come out because a model can be talked into repeating one.
 */

/** Marks that draw nothing: zero-width, direction overrides, variation selectors, tag characters. */
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]|[\u{E0000}-\u{E0FFF}]/gu;
/** Control characters, except the tab and newline a person can see. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const URL = /(?:\b(?:https?|ftp):\/\/|\bwww\.)[^\s<>"')\]]+/gi;
const CUT = '\n[…cut here: the rest was longer than this allows]';

export const MAX_ITEM_CHARS = 8_000;

export function cleanText(text: string | null | undefined, max = MAX_ITEM_CHARS): string {
  const clean = (text ?? '')
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(CONTROL, '')
    .replace(URL, '[link removed]')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return clean.length > max ? clean.slice(0, max - CUT.length).trimEnd() + CUT : clean;
}

const EXTENSION: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

function bytes(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out.buffer;
}

/** Read one handed-over file here, or say why not. */
export async function fileToText(file: ConnectedFile, couldNotRead: string): Promise<ConnectedText | Skipped> {
  const ext = EXTENSION[file.mime] ?? '';
  const name = file.title.toLowerCase().endsWith(ext) ? file.title : `${file.title}${ext}`;
  let result: { text: string } | { error: string };
  try {
    result = await extractText(name, bytes(file.data_base64));
  } catch {
    result = { error: couldNotRead };
  }
  if ('error' in result) return { id: file.id, title: file.title, reason: result.error || couldNotRead };
  const text = cleanText(result.text);
  if (!text) return { id: file.id, title: file.title, reason: couldNotRead };
  return { id: file.id, toolkit: file.toolkit, kind: 'file', source: file.source, title: file.title, text };
}
