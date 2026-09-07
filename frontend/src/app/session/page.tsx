import { redirect } from 'next/navigation';

/**
 * /session is retired. It redirects rather than 404s.
 *
 * The five-phase flow lived here for the whole of Phase 1, so the URL is in
 * bookmarks, in browser history and in at least one screenshot. Every session
 * it used to open has been imported into `/projects` — the same objective, the
 * same output, the same version history — so the project list is the honest
 * destination rather than a soft landing: what the user came for is there.
 *
 * A temporary redirect, deliberately. The permanent variant answers 308, which
 * the browser caches more or less forever, and this route may yet want to be
 * something else.
 */
export default function SessionRedirect(): never {
  redirect('/projects');
}
