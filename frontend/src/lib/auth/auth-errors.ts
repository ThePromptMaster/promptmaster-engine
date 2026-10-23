import { DICTIONARIES } from '@/lib/i18n/translate';
import { getLocale, tr } from '@/lib/i18n/store';
import type { MessageKey } from '@/lib/i18n/messages/en';

/**
 * What a sign-in error says, in the interface language (23 Oct: the whole site
 * in the chosen language).
 *
 * Supabase writes its errors in English and gives each a `code`
 * (`invalid_credentials`, `over_request_rate_limit`, …). In English the
 * message is shown as it always was. In another language a known code gets its
 * own sentence; an unknown one gets this page's own fallback, with Supabase's
 * words after it so nothing is hidden.
 */
export function authErrorMessage(err: unknown, fallback: MessageKey): string {
  const raw = err instanceof Error ? err.message : typeof (err as { message?: unknown })?.message === 'string' ? String((err as { message: string }).message) : '';
  if (getLocale() === 'en') return raw || tr(fallback);
  const code = typeof (err as { code?: unknown })?.code === 'string' ? String((err as { code: string }).code) : '';
  const key = `auth.code.${code}`;
  if (code && key in DICTIONARIES.en) return tr(key as MessageKey);
  return raw ? `${tr(fallback)} (${raw})` : tr(fallback);
}
