/**
 * /session sends people to /projects rather than 404ing.
 *
 * The five-phase flow lived at this URL for the whole of Phase 1, so it is in
 * bookmarks and history. Every session it opened has been imported into
 * /projects, so the list is where what the user came for actually is — and a
 * 404 would tell them, wrongly, that it is gone.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

// Next's real redirect throws a control-flow signal rather than returning,
// which is why the page's return type is `never`. Mirror that, or a page that
// fell through to rendering would still pass. Declared inside the factory
// because vi.mock is hoisted above every top-level binding.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

const { redirect } = await import('next/navigation');

import SessionRedirect from './page';

describe('the retired /session route', () => {
  it('redirects to the project list', () => {
    expect(() => SessionRedirect()).toThrow('NEXT_REDIRECT:/projects');
    expect(redirect).toHaveBeenCalledWith('/projects');
  });

  it('does not permanently redirect, and keeps nothing of the old flow', () => {
    // A 308 is cached by browsers more or less forever, and this route may yet
    // want to be something else. Read from source rather than from the mock —
    // asserting on the double would only prove the double.
    const source = readFileSync(
      join(process.cwd(), 'src', 'app', 'session', 'page.tsx'),
      'utf8'
    );
    expect(source).not.toMatch(/permanentRedirect/);
    expect(source).not.toMatch(/session-store|components\/phases|SessionShell/);
  });
});
