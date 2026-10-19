/**
 * Links in what the user asked for (Sean, 18 Oct, email 7): a beta user's
 * cookbook depended on an Instagram account's videos, and nothing told him
 * that PromptMaster never opens a link — the backend fetches no user URL. The
 * start says so as soon as a link is typed, before any work is done on it.
 */

const URL_LIKE = /\bhttps?:\/\/[^\s<>"')]+|\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s<>"')]*/gi;
const VIDEO_HOSTS = /\b(?:instagram\.com|instagr\.am|youtube\.com|youtu\.be|tiktok\.com|vimeo\.com|facebook\.com|fb\.watch|x\.com|twitter\.com)\b/i;
/** A named platform without a URL: "recipes from an Instagram account". */
const PLATFORM_WORDS = /\b(?:instagram|youtube|tiktok|vimeo|reels?)\b/i;

export interface LinksFound {
  /** Web addresses written in the text. */
  urls: string[];
  /** A video or social platform is linked or named. */
  video: boolean;
}

export function linksIn(text: string): LinksFound {
  // A sentence's closing punctuation is not part of the address.
  const urls = [...new Set((text.match(URL_LIKE) ?? []).map((u) => u.replace(/[.,;:!?)]+$/, '')))];
  const video = urls.some((u) => VIDEO_HOSTS.test(u)) || PLATFORM_WORDS.test(text);
  return { urls, video };
}

/** What the start says, or null when there is nothing to say. */
export function sourceAccessNote(text: string): string | null {
  const { urls, video } = linksIn(text);
  if (!urls.length && !video) return null;
  return video
    ? "PromptMaster can't open links or watch videos. Paste the text — a transcript, captions, a description — or upload files (PDF, Word, CSV, images)."
    : "PromptMaster can't open links. Paste the text you want it to use, or upload files (PDF, Word, CSV, images).";
}
