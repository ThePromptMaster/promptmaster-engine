import { resolveLanguage, type LanguageCode } from '@/lib/workflow/languages';

/**
 * The language the backend is asked to write in, sent with every call (client,
 * 21 Oct: "pick your language"). Module-level like the thinking level: the
 * workspace sets it from the project and clears it on unmount; the start
 * screen sets it from its own picker.
 */
let current: LanguageCode = 'en';

export const LANGUAGE_HEADER = 'X-PromptMaster-Language';

export function setRequestLanguage(code: string | null | undefined): void {
  current = resolveLanguage(code);
}

/** The header to send, or none for English (the backend's default). */
export function languageHeaders(): Record<string, string> {
  return current === 'en' ? {} : { [LANGUAGE_HEADER]: current };
}
